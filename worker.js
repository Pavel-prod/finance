export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    try {
      const payload = await request.json();
      const token = env.NOTION_TOKEN;
      const databaseId = env.NOTION_DATABASE_ID;

      if (!token || !databaseId) {
        return new Response(JSON.stringify({ error: 'Missing Notion config' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (payload.type !== 'week') {
        return new Response(JSON.stringify({ skipped: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const properties = {
        'Неделя': { title: [{ text: { content: payload.label || '' } }] },
        'Даты': { rich_text: [{ text: { content: payload.dates || '' } }] },
        'Доход ЗП': { number: payload.income ?? null },
        'Доход компания': { number: payload.comp ?? null },
        'Расходы': { number: payload.spent ?? null },
        'СберКарта остаток': { number: payload.sber ?? null },
        'Авто остаток': { number: payload.car ?? null },
        'Заметка': { rich_text: [{ text: { content: payload.note || '' } }] },
        'Источник': { rich_text: [{ text: { content: 'PWA' } }] },
      };

      const notionRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
      });

      const data = await notionRes.json();
      return new Response(JSON.stringify(data), {
        status: notionRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
