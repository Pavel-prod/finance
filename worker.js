export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const token = env.NOTION_TOKEN;
    const dbId  = env.NOTION_DATABASE_ID;
    const nh = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };
    const jh = { ...cors, 'Content-Type': 'application/json' };

    try {
      if (request.method === 'GET') {
        const qRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST', headers: nh,
          body: JSON.stringify({ page_size: 100 })
        });
        const qData = await qRes.json();
        const weeks = [];
        let envelopes = null;
        let investments = null;

        for (const page of qData.results || []) {
          const p = page.properties;
          const label = p['Неделя']?.title?.[0]?.text?.content || '';
          const bRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, { headers: nh });
          const bData = await bRes.json();
          let txns = [];
          let configData = null;
          for (const block of bData.results || []) {
            if (block.type === 'code') {
              try {
                const txt = (block.code?.rich_text || []).map(r => r.text?.content || '').join('');
                const obj = JSON.parse(txt);
                if (Array.isArray(obj)) txns = [...txns, ...obj];
                else if (obj && obj._type === 'config') configData = obj;
              } catch (e) {}
            }
          }
          if (label === '__CONFIG__' && configData) {
            envelopes = configData.envelopes || null;
            investments = configData.investments || null;
          } else if (label && label !== '__CONFIG__') {
            weeks.push({
              id:           p['Источник']?.rich_text?.[0]?.text?.content || page.id,
              notionPageId: page.id,
              label,
              dates:   p['Даты']?.rich_text?.[0]?.text?.content || '',
              income:  p['Доход ЗП']?.number    ?? null,
              comp:    p['Доход компания']?.number ?? null,
              carComp: p['Авто компания']?.number  ?? 10000,
              spent:   p['Расходы']?.number      ?? null,
              sber:    p['СберКарта остаток']?.number ?? null,
              car:     p['Авто остаток']?.number  ?? null,
              note:    p['Заметка']?.rich_text?.[0]?.text?.content || '',
              transactions: txns,
            });
          }
        }
        weeks.sort((a, b) => (a.id < b.id ? -1 : 1));
        return new Response(JSON.stringify({ weeks, envelopes, investments }), { headers: jh });
      }

      if (request.method === 'POST') {
        const payload = await request.json();

        if (payload.type === 'week') {
          const { id, label, dates, income, comp, carComp, spent, sber, car, note, transactions, notionPageId } = payload;
          const props = {
            'Неделя':            { title:     [{ text: { content: label  || '' } }] },
            'Даты':              { rich_text: [{ text: { content: dates  || '' } }] },
            'Доход ЗП':         { number: income   ?? null },
            'Доход компания':    { number: comp     ?? null },
            'Авто компания':     { number: carComp  ?? 10000 },
            'Расходы':           { number: spent    ?? null },
            'СберКарта остаток': { number: sber     ?? null },
            'Авто остаток':      { number: car      ?? null },
            'Заметка':           { rich_text: [{ text: { content: (note || '').slice(0, 1900) } }] },
            'Источник':          { rich_text: [{ text: { content: id    || '' } }] },
          };
          let pageId = notionPageId || null;
          if (!pageId) {
            const cRes = await fetch('https://api.notion.com/v1/pages', {
              method: 'POST', headers: nh,
              body: JSON.stringify({ parent: { database_id: dbId }, properties: props })
            });
            pageId = (await cRes.json()).id;
          } else {
            await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
              method: 'PATCH', headers: nh,
              body: JSON.stringify({ properties: props })
            });
            const bRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, { headers: nh });
            const bData = await bRes.json();
            for (const block of bData.results || []) {
              await fetch(`https://api.notion.com/v1/blocks/${block.id}`, { method: 'DELETE', headers: nh });
            }
          }
          if (pageId && Array.isArray(transactions) && transactions.length > 0) {
            const json = JSON.stringify(transactions);
            const chunks = [];
            for (let i = 0; i < json.length; i += 1900) chunks.push(json.slice(i, i + 1900));
            await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
              method: 'PATCH', headers: nh,
              body: JSON.stringify({
                children: chunks.map(c => ({
                  object: 'block', type: 'code',
                  code: { rich_text: [{ type: 'text', text: { content: c } }], language: 'json' }
                }))
              })
            });
          }
          return new Response(JSON.stringify({ ok: true, notionPageId: pageId }), { headers: jh });
        }

        if (payload.type === 'config') {
          const qRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
            method: 'POST', headers: nh,
            body: JSON.stringify({ filter: { property: 'Неделя', title: { equals: '__CONFIG__' } } })
          });
          const qData = await qRes.json();
          let cfgId = qData.results?.[0]?.id || null;
          if (!cfgId) {
            const cRes = await fetch('https://api.notion.com/v1/pages', {
              method: 'POST', headers: nh,
              body: JSON.stringify({ parent: { database_id: dbId }, properties: {
                'Неделя':   { title:     [{ text: { content: '__CONFIG__' } }] },
                'Источник': { rich_text: [{ text: { content: 'config'      } }] },
              }})
            });
            cfgId = (await cRes.json()).id;
          } else {
            const bRes = await fetch(`https://api.notion.com/v1/blocks/${cfgId}/children`, { headers: nh });
            const bData = await bRes.json();
            for (const block of bData.results || []) {
              await fetch(`https://api.notion.com/v1/blocks/${block.id}`, { method: 'DELETE', headers: nh });
            }
          }
          if (cfgId) {
            const json = JSON.stringify({ _type: 'config', envelopes: payload.envelopes, investments: payload.investments });
            const chunks = [];
            for (let i = 0; i < json.length; i += 1900) chunks.push(json.slice(i, i + 1900));
            await fetch(`https://api.notion.com/v1/blocks/${cfgId}/children`, {
              method: 'PATCH', headers: nh,
              body: JSON.stringify({
                children: chunks.map(c => ({
                  object: 'block', type: 'code',
                  code: { rich_text: [{ type: 'text', text: { content: c } }], language: 'json' }
                }))
              })
            });
          }
          return new Response(JSON.stringify({ ok: true }), { headers: jh });
        }
      }

      return new Response('Not found', { status: 404, headers: cors });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jh });
    }
  }
};
};
