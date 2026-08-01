#!/usr/bin/env bun
/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ⚠  DANGER — DESTRUCTIVE, WRITE-HEAVY END-TO-END TEST. TESTBED ONLY.     │
 * │                                                                          │
 * │  This script creates a throwaway auth user, writes real rows (profile,   │
 * │  device), and DELETES the user (with cascade) afterward. NEVER point it  │
 * │  at a production Supabase project.                                       │
 * │  It refuses to run unless RUNBOOK_ALLOW_ROUNDTRIP=1 is set.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Level B re-certification harness: one command exercises the whole template
 * against a live API + Supabase — profile → device (FK order). Cleans up after
 * itself even on failure (try/finally).
 *
 * TODO(wave-1): replace with the nanny round-trip — the widget CRUD /
 * generate-description / notify / job-endpoint / quota-gate / atomic-counter
 * steps that used to live here were removed along with the widget and
 * subscription example domains.
 *
 * Usage:
 *   RUNBOOK_ALLOW_ROUNDTRIP=1 bun scripts/level-b-roundtrip.ts
 *
 * Config (from the environment; a local `.env` in cwd is auto-loaded):
 *   SUPABASE_URL           required
 *   SUPABASE_SERVICE_KEY   required (service role — admin user create/delete)
 *   SUPABASE_ANON_KEY      required (sign in for a real JWT)
 *   API_BASE_URL           optional (default http://127.0.0.1:8099)
 *
 * Exit code is non-zero if any assertion fails, so CI can gate on it.
 *
 * @module scripts/level-b-roundtrip
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// ── Safety guard ─────────────────────────────────────────────────────────────
if (process.env.RUNBOOK_ALLOW_ROUNDTRIP !== '1') {
  console.error(
    '✗ Refusing to run. This is a destructive, write-heavy testbed harness.\n' +
      '  Set RUNBOOK_ALLOW_ROUNDTRIP=1 to confirm this is NOT a production project.'
  );
  process.exit(2);
}

// ── Config ───────────────────────────────────────────────────────────────────
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ Missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

const SUPABASE_URL = required('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = required('SUPABASE_SERVICE_KEY');
const SUPABASE_ANON_KEY = required('SUPABASE_ANON_KEY');
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8099';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// Random throwaway identity (`.test` TLD is reserved and never routable).
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL = `roundtrip+${suffix}@example.test`;
const PASSWORD = `Rt-${Math.random().toString(36).slice(2)}-9A!`;

// ── Assertion tracking ───────────────────────────────────────────────────────
const passes: string[] = [];
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passes.push(line);
    console.log(`✓ ${line}`);
  } else {
    failures.push(line);
    console.log(`✗ ${line}`);
  }
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
interface ApiResult {
  status: number;
  body: Record<string, unknown> | null;
}

let token = '';
async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<ApiResult> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// ── Run ──────────────────────────────────────────────────────────────────────
let createdUserId: string | null = null;

console.log(`\n🔁 Level B round-trip — ${API_BASE_URL}`);
console.log(`   throwaway user: ${EMAIL}\n`);

try {
  // 1. Create the throwaway user + sign in for a real JWT.
  const { data: createdData, error: createErr } =
    await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
  createdUserId = createdData.user?.id ?? null;
  check('admin createUser', !createErr && !!createdUserId, createErr?.message);

  const { data: signInData, error: signInErr } =
    await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  token = signInData.session?.access_token ?? '';
  check(
    'sign in → JWT',
    !signInErr && token.length > 20,
    signInErr?.message ?? `token …${token.slice(-6)}`
  );
  if (!token) {
    throw new Error('No access token — cannot continue.');
  }

  // 2. Profile create — the FK-parent row for device registration.
  const profile = await api('POST', '/api/v1/users/profile', {
    name: 'Round Trip',
    city: 'Testville',
    country: 'Testland',
  });
  check(
    'POST /users/profile → 201',
    profile.status === 201 && profile.body?.success === true,
    `status ${profile.status}`
  );

  // 3. Device register — MUST be after the profile (FK ordering contract).
  const device = await api('POST', '/api/v1/notifications/devices', {
    deviceId: `rt-device-${suffix}`,
    expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    platform: 'ios',
    notificationPermission: 'granted',
    timezone: 'America/Los_Angeles',
    appVersion: '1.0.0',
  });
  check(
    'POST /notifications/devices → 2xx (FK order OK)',
    device.status >= 200 &&
      device.status < 300 &&
      device.body?.success === true,
    `status ${device.status}`
  );

  // TODO(wave-1): replace with the nanny round-trip — widget/subscription CRUD,
  // LLM-description, notify, job-endpoint, quota-gate, and atomic-counter steps
  // used to live here (see the widget/subscription example domains this
  // template shipped with) and were removed along with those domains.
} catch (error) {
  check(
    'unexpected error',
    false,
    error instanceof Error ? error.message : String(error)
  );
} finally {
  // Always clean up the throwaway user (cascades profile/device rows).
  if (createdUserId) {
    const { error: delErr } = await admin.auth.admin.deleteUser(createdUserId);
    console.log(
      delErr
        ? `\n⚠ cleanup FAILED to delete user ${createdUserId.slice(0, 8)}: ${delErr.message}`
        : `\n🧹 cleaned up throwaway user ${createdUserId.slice(0, 8)} (+ cascade)`
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(
  `\n──────── ${passes.length} pass / ${failures.length} fail ────────`
);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
}
process.exit(failures.length === 0 ? 0 : 1);
