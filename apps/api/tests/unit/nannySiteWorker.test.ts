/**
 * @module tests/unit/nannySiteWorker.test
 *
 * Contract for `infra/nanny-site/worker.js`'s `/t/:code` route (D-37, spec
 * §6.2). The worker is a separate deployable with no test root of its own;
 * this file lives here for the same reason the migration contracts do — it is
 * a repo-level guard, and `apps/api/tests/unit` is where `bun run qc`
 * actually runs them.
 *
 * WHY THIS FILE EXISTS AT ALL. `/t/:code` is the only PUBLIC, UNAUTHENTICATED
 * surface in this product that carries a nanny's pay rate, and the owner
 * approved it there conditionally (D-51): per-invite revoke, a 7-day default
 * link window, and the page dying the instant the code is redeemed. The API
 * owns enforcing those; this file pins the two halves the WORKER owns and
 * could regress on its own —
 *
 *   1. every failure renders the SAME opaque page, so the page can never
 *      become an oracle that tells a stranger which codes are real; and
 *   2. nothing from the API is interpolated into HTML unescaped, because
 *      those strings include text a nanny typed.
 *
 * It also pins the thing most likely to be "helpfully" broken later: the
 * worker formats NOTHING. Every label, value and figure arrives pre-rendered
 * from the API's `renderTermRows`/`renderTermsHeader`, which is what keeps the
 * web page and the app word-identical instead of merely similar.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// @ts-expect-error — plain ESM JS worker, no types, deliberately not built.
import worker from '../../../../infra/nanny-site/worker.js';

const WORKER_PATH = join(
  import.meta.dir,
  '../../../../infra/nanny-site/worker.js'
);
const workerSource = readFileSync(WORKER_PATH, 'utf8');

const API_BASE_URL = 'https://api.example.test';
const CODE = 'R4K-92T';

const PREVIEW = {
  code: CODE,
  carer_name: 'Marisol M.',
  proposed_at: 'Aug 10',
  link_expires_at: 'Aug 17',
  rate: '$28.00',
  weekly_line: '$1,540.00 a week at 50 guaranteed hours',
  weekly_equivalent_minor: 154_000,
  rows: [
    { label: 'Overtime', value: 'After 40h at 1.5x · after 8h a day' },
    { label: 'Cancellations', value: 'No cancellation pay' },
    { label: 'Mileage', value: 'Not set' },
    { label: 'Starts', value: 'Monday Aug 17' },
  ],
};

/** A `ctx` that runs `waitUntil` work eagerly so the receipts are observable. */
function makeCtx() {
  const scheduled: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => scheduled.push(p) },
    scheduled,
  };
}

type FetchCall = { url: string; method: string };

/** Stubs global fetch and records every outbound call the worker makes. */
function withStubbedFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function get(path: string) {
  return new Request(`https://nanny.getsteadily.app${path}`);
}

describe('/t/:code — the happy path renders the API’s strings verbatim', () => {
  it('prints the rate, the weekly line and every row it was given', async () => {
    const { restore } = withStubbedFetch(() =>
      Response.json({ success: true, data: PREVIEW })
    );
    const { ctx } = makeCtx();
    const res = await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx);
    const html = await res.text();
    restore();

    expect(res.status).toBe(200);
    expect(html).toContain('$28.00');
    expect(html).toContain('$1,540.00 a week at 50 guaranteed hours');
    for (const row of PREVIEW.rows) {
      expect(html).toContain(row.label);
      expect(html).toContain(row.value);
    }
  });

  // T16 survives the trip: the API resolves null into an explicit word, and
  // the worker must not "improve" either of them into a fabricated $0.00.
  it('passes T16’s null words through untouched', async () => {
    const { restore } = withStubbedFetch(() =>
      Response.json({ success: true, data: PREVIEW })
    );
    const { ctx } = makeCtx();
    const html = await (
      await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx)
    ).text();
    restore();

    expect(html).toContain('No cancellation pay');
    expect(html).toContain('Not set');
    expect(html).not.toContain('$0.00');
  });

  it('prints the code as selectable text for §3.4’s mode b', async () => {
    const { restore } = withStubbedFetch(() =>
      Response.json({ success: true, data: PREVIEW })
    );
    const { ctx } = makeCtx();
    const html = await (
      await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx)
    ).text();
    restore();

    expect(html).toContain('Or enter this code in the app');
    expect(html).toContain(CODE);
  });

  // A message preview is the most-screenshotted, most-forwarded surface in the
  // chain, and her rate is the thing she is most afraid of leaking.
  it('keeps the rate OUT of the Open Graph tags', async () => {
    const { restore } = withStubbedFetch(() =>
      Response.json({ success: true, data: PREVIEW })
    );
    const { ctx } = makeCtx();
    const html = await (
      await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx)
    ).text();
    restore();

    const og = html.slice(0, html.indexOf('</head>'));
    expect(og).toContain('og:title');
    expect(og).toContain('sent you her working terms');
    expect(og).not.toContain('$28.00');
    expect(og).not.toContain('1,540');
  });

  // D-51's third condition. A CDN holding this page for even a minute would
  // leave her rate readable after the code was spent and the private copy
  // existed.
  it('is never cached', async () => {
    const { restore } = withStubbedFetch(() =>
      Response.json({ success: true, data: PREVIEW })
    );
    const { ctx } = makeCtx();
    const res = await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx);
    restore();

    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('/t/:code — every failure is the SAME opaque page', () => {
  // The API collapses all five death conditions into one 404 so the page
  // cannot confirm a code was ever real. The worker must not undo that by
  // reacting differently to any of them.
  it.each([404, 410, 403, 500])(
    'renders the dead-link page for an API %s, naming no reason',
    async status => {
      const { restore } = withStubbedFetch(
        () => new Response('', { status })
      );
      const { ctx } = makeCtx();
      const res = await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx);
      const html = await res.text();
      restore();

      expect(res.status).toBe(404);
      expect(html).toContain("This link isn't active any more");
      // No hint at which condition closed it, and no echo of the code.
      expect(html).not.toContain(CODE);
      expect(html).not.toContain('expired');
      expect(html).not.toContain('revoked');
      expect(html).not.toContain('redeemed');
    }
  );

  it('renders the same page when the API is unreachable', async () => {
    const { restore } = withStubbedFetch(() => {
      throw new Error('network down');
    });
    const { ctx } = makeCtx();
    const res = await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx);
    restore();

    // A dead API is indistinguishable from a dead code on purpose: the
    // alternative is a 500 page that confirms the code was real.
    expect(res.status).toBe(404);
  });

  it('carries no Open Graph tags on the dead page', async () => {
    const { restore } = withStubbedFetch(
      () => new Response('', { status: 404 })
    );
    const { ctx } = makeCtx();
    const html = await (
      await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx)
    ).text();
    restore();

    expect(html).not.toContain('og:title');
  });
});

describe('/t/:code — the receipts fire only for a code that resolved', () => {
  it('stamps opened_at and captures link_opened on success', async () => {
    const { calls, restore } = withStubbedFetch(url =>
      url.includes('terms-preview')
        ? Response.json({ success: true, data: PREVIEW })
        : new Response(null, { status: 204 })
    );
    const { ctx, scheduled } = makeCtx();
    await worker.fetch(
      get(`/t/${CODE}`),
      { API_BASE_URL, POSTHOG_API_KEY: 'phc_test' },
      ctx
    );
    await Promise.all(scheduled);
    restore();

    expect(calls.some(c => c.url.endsWith('/opened') && c.method === 'POST'))
      .toBe(true);
    expect(calls.some(c => c.url.includes('/capture/'))).toBe(true);
  });

  // Her "Opened" pill has to mean the family actually saw her terms. A dead
  // code that stamped it would make the one signal she has between sending
  // and hearing back a lie.
  it('fires neither receipt for a dead code', async () => {
    const { calls, restore } = withStubbedFetch(
      () => new Response('', { status: 404 })
    );
    const { ctx, scheduled } = makeCtx();
    await worker.fetch(
      get(`/t/${CODE}`),
      { API_BASE_URL, POSTHOG_API_KEY: 'phc_test' },
      ctx
    );
    await Promise.all(scheduled);
    restore();

    expect(calls.some(c => c.url.endsWith('/opened'))).toBe(false);
    expect(calls.some(c => c.url.includes('/capture/'))).toBe(false);
  });

  it('sends no analytics at all when no PostHog key is configured', async () => {
    const { calls, restore } = withStubbedFetch(url =>
      url.includes('terms-preview')
        ? Response.json({ success: true, data: PREVIEW })
        : new Response(null, { status: 204 })
    );
    const { ctx, scheduled } = makeCtx();
    await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx);
    await Promise.all(scheduled);
    restore();

    expect(calls.some(c => c.url.includes('/capture/'))).toBe(false);
  });
});

describe('/t/:code — the page is public, so nothing is trusted', () => {
  // `rows` carry text a nanny typed — a stipend label, her note. This page has
  // no membership check behind it and no framework escaping for it.
  it('escapes HTML from every API-supplied string', async () => {
    const hostile = {
      ...PREVIEW,
      carer_name: '<script>alert(1)</script>',
      rows: [{ label: '<img src=x onerror=alert(1)>', value: '"><b>x</b>' }],
    };
    const { restore } = withStubbedFetch(() =>
      Response.json({ success: true, data: hostile })
    );
    const { ctx } = makeCtx();
    const html = await (
      await worker.fetch(get(`/t/${CODE}`), { API_BASE_URL }, ctx)
    ).text();
    restore();

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuses a non-GET method rather than proxying it onward', async () => {
    const { ctx } = makeCtx();
    const res = await worker.fetch(
      new Request(`https://nanny.getsteadily.app/t/${CODE}`, {
        method: 'POST',
      }),
      { API_BASE_URL },
      ctx
    );
    expect(res.status).toBe(405);
  });

  it('does not treat a nested path as a code', async () => {
    const { calls, restore } = withStubbedFetch(() => new Response('ok'));
    const { ctx } = makeCtx();
    await worker.fetch(get('/t/abc/def'), { API_BASE_URL }, ctx);
    restore();
    // Falls through to the Lovable proxy, never to terms-preview.
    expect(calls.some(c => c.url.includes('terms-preview'))).toBe(false);
  });
});

describe('worker source — the formatting stays on the server', () => {
  // If a figure is ever computed here, the web page and the app can disagree
  // about the same contract. At $28.00 with overtime after 40h, 50 guaranteed
  // hours is $1,540.00; a naive multiply prints $1,400.00, which is precisely
  // the error that gets an app disbelieved against payroll forever.
  it('contains no currency formatting and no arithmetic on money', () => {
    expect(workerSource).not.toContain('toFixed');
    expect(workerSource).not.toContain('Intl.NumberFormat');
    expect(workerSource).not.toContain('_minor *');
    expect(workerSource).not.toContain('/ 100');
  });

  it('hashes the code before it reaches analytics, never sending it raw', () => {
    expect(workerSource).toContain('SHA-256');
    expect(workerSource).toContain('code_hash');
  });

  it('leaves the existing well-known and waitlist routes in place', () => {
    expect(workerSource).toContain('apple-app-site-association');
    expect(workerSource).toContain('/api/waitlist');
  });
});
