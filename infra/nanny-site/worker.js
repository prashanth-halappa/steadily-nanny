// Serves nanny.getsteadily.app: /api/waitlist writes to D1, everything else
// proxies to the Lovable-hosted landing page.
const ORIGIN = 'steadily-nanny.lovable.app';

// CORS is open so the form also works from the *.lovable.app preview/editor.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/waitlist') {
      if (request.method === 'OPTIONS')
        return new Response(null, { headers: CORS });
      if (request.method !== 'POST') {
        return Response.json(
          { ok: false, error: 'Method not allowed.' },
          { status: 405, headers: CORS }
        );
      }
      let email = '';
      try {
        const body = await request.json();
        if (typeof body.email === 'string')
          email = body.email.trim().toLowerCase();
      } catch {
        // fall through to validation error
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json(
          { ok: false, error: 'Please enter a valid email address.' },
          { status: 400, headers: CORS }
        );
      }
      await env.DB.prepare('INSERT OR IGNORE INTO waitlist (email) VALUES (?)')
        .bind(email)
        .run();
      return Response.json({ ok: true }, { headers: CORS });
    }

    url.hostname = ORIGIN;
    return fetch(url, request);
  },
};
