#!/usr/bin/env bun
/**
 * QA — API smoke harness (READ-ONLY).
 *
 * Signs in through Better Auth (email/password), then hits the lean-core GET
 * endpoints with that session cookie, asserting the HTTP status and that the
 * body is a valid success envelope (never `{ success:false }` on a 2xx).
 *
 * Usage:
 *   QA_EMAIL=parent@steadilynanny.test QA_PASSWORD=... bun scripts/qa-smoke.ts
 *   QA_BASE_URL="http://localhost:8080" QA_EMAIL=... QA_PASSWORD=... bun scripts/qa-smoke.ts
 *
 * Exit code is non-zero if any check fails, so it can gate CI.
 */

export {}; // module scope for top-level await

const BASE_URL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:8080';
const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('✗ QA_EMAIL and QA_PASSWORD env vars are required.');
  process.exit(2);
}

const signIn = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!signIn.ok) {
  console.error(`✗ sign-in failed: ${signIn.status} ${await signIn.text()}`);
  process.exit(2);
}
// The API authenticates by session cookie.
const COOKIE = signIn.headers
  .getSetCookie()
  .map(c => c.split(';')[0])
  .join('; ');

interface Result {
  domain: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  ms: number;
  note: string;
}

const results: Result[] = [];

async function call(
  domain: string,
  method: string,
  path: string,
  expect: number[] = [200],
  auth = true
): Promise<unknown> {
  const start = performance.now();
  let status = 0;
  let body: unknown = null;
  let note = '';
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(auth ? { Cookie: COOKIE } : {}),
        'Content-Type': 'application/json',
        'x-app-version': 'qa-smoke',
        'x-app-platform': 'ios',
      },
    });
    status = res.status;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      note = 'non-JSON body';
      body = text.slice(0, 120);
    }
    // Flag error envelopes even on a 200 ({ success:false, error }).
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (b.success === false && status < 400) {
        note = `error envelope: ${JSON.stringify(b.error).slice(0, 100)}`;
      }
    }
  } catch (e) {
    note = `fetch failed: ${(e as Error).message}`;
  }
  const ms = Math.round(performance.now() - start);
  const ok =
    expect.includes(status) &&
    !note.startsWith('error envelope') &&
    !note.startsWith('fetch failed');
  results.push({ domain, method, path, status, ok, ms, note });
  return body;
}

console.log(`\n🔎 API smoke — ${BASE_URL}\n`);

// ── Core endpoints ─────────────────────────────────────────────────────────
await call('health', 'GET', '/health', [200], false);
await call('app', 'GET', '/api/app/status', [200], false);
await call('user', 'GET', '/api/v1/users/me', [200, 404]); // 404 = profile not created yet

// TODO(wave-1): replace with the nanny round-trip — add this app's own
// domain GET endpoints here (the widget/subscription example round-trip
// that used to live here was removed along with those example domains).

// ── Report ───────────────────────────────────────────────────────────────
const pass = results.filter(r => r.ok);
const fail = results.filter(r => !r.ok);

if (fail.length) {
  console.log('── Failures ──');
  for (const r of fail) {
    console.log(`  ✗ [${r.status || 'ERR'}] ${r.method} ${r.path}  (${r.ms}ms)  ${r.note}`);
  }
}

console.log(`\n${fail.length === 0 ? '✅' : '❌'} ${pass.length}/${results.length} passed\n`);
process.exit(fail.length === 0 ? 0 : 1);
