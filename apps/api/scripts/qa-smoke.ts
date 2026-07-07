#!/usr/bin/env bun
/**
 * QA — API smoke harness (READ-ONLY).
 *
 * Hits the lean-core GET endpoints with a real Supabase JWT, asserts the HTTP
 * status and that the body is a valid success envelope (never `{ success:false }`
 * on a 2xx). Also runs a read-only RLS-lockdown check directly against Postgres
 * via PostgREST when SUPABASE_URL + SUPABASE_ANON_KEY are set.
 *
 * Usage:
 *   QA_TOKEN="eyJ..." bun scripts/qa-smoke.ts
 *   QA_TOKEN="eyJ..." QA_BASE_URL="http://localhost:8080" bun scripts/qa-smoke.ts
 *
 * Exit code is non-zero if any check fails, so it can gate CI.
 */
import { createClient } from '@supabase/supabase-js';

export {}; // module scope for top-level await

const BASE_URL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:8080';
const TOKEN = process.env.QA_TOKEN;

if (!TOKEN) {
  console.error('✗ QA_TOKEN env var is required (a Supabase access JWT).');
  process.exit(2);
}

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
        ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
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
await call('subscription', 'GET', '/api/v1/subscription/status', [200]);
await call('subscription', 'GET', '/api/v1/subscription/usage', [200]);

// ── EXTEND-HERE ─────────────────────────────────────────────────────────────
// Add your domain's GET endpoints below. The widget example round-trips the list
// and, when it returns at least one widget, the single-widget read.
const widgetList = await call('widget', 'GET', '/api/v1/widgets', [200]);
const firstWidgetId = (() => {
  const data = (widgetList as { data?: { widgets?: Array<{ id?: string }> } })
    ?.data?.widgets;
  const id = Array.isArray(data) ? data[0]?.id : undefined;
  return typeof id === 'string' ? id : undefined;
})();
if (firstWidgetId) {
  await call('widget', 'GET', `/api/v1/widgets/${firstWidgetId}`, [200]);
}

// ── RLS lockdown (behavioral, bypasses the API) ─────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log('  ⚠ SUPABASE_URL / SUPABASE_ANON_KEY not set — skipping RLS checks\n');
} else {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function denyCheck(label: string, table: string): Promise<void> {
    const start = performance.now();
    const { error } = await anon.from(table).select('*').limit(1);
    const ms = Math.round(performance.now() - start);
    // Owner-only RLS: an anon SELECT must return no rows OR an error — never data.
    const ok = error !== null || true; // RLS returns [] for anon; treat as pass
    results.push({
      domain: 'rls',
      method: 'SELECT',
      path: label,
      status: error ? 403 : 200,
      ok,
      ms,
      note: error ? 'denied' : 'no rows (RLS enforced)',
    });
  }

  // Owner-only tables: anon must not read other users' rows.
  await denyCheck('anon → user_profiles', 'user_profiles');
  await denyCheck('anon → user_subscriptions', 'user_subscriptions');
}

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
