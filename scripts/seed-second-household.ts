#!/usr/bin/env bun
/**
 * Seed a SECOND household that the same nanny also works for.
 *
 * WHY
 * The cross-family anonymity promise is the load-bearing claim of this product:
 * the Reyes may learn Nia is unavailable, never that she is with the Coles. That
 * claim is only testable if Nia actually belongs to two households. With one
 * household there is nothing to leak, so the assertion passes vacuously — and a
 * test that cannot fail is not evidence.
 *
 * This seeds the second household directly against the database rather than
 * through the UI, deliberately: e2e flow 4 already covers joining a household by
 * invite code through the app. Flow 8 is about what a DIFFERENT family can READ,
 * so the join mechanism is not what is under test here.
 *
 * Idempotent. Safe to run repeatedly.
 *
 * Run AFTER scripts/seed-test-users.ts and after the nanny has joined the first
 * household through the app.
 *
 * Usage: bun run scripts/seed-second-household.ts
 *
 * @module scripts/seed-second-household
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl } from './localSupabaseGuard';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const OTHER_PARENT_EMAIL = 'otherparent@steadilynanny.test';
const TEST_PASSWORD = 'SteadilyTest!2026';

/** Deliberately distinctive: if any of these strings ever surfaces in the first
 *  household's UI or API responses, the anonymity promise is broken and the
 *  string makes it obvious in a screenshot or a log. */
const OTHER_HOUSEHOLD_NAME = 'LEAKCANARY the Cole household';
const OTHER_CHILD_NAME = 'LEAKCANARY-Ada';

function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const repoRoot = join(import.meta.dir, '..');
const env = loadEnvFile(join(repoRoot, 'apps/api/.env'));
const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey || serviceKey.startsWith('SET-ME')) {
  console.error(
    'Missing or placeholder SUPABASE_URL / SUPABASE_SERVICE_KEY in apps/api/.env'
  );
  process.exit(1);
}
assertLocalSupabaseUrl(url);

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(u => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureUser(email: string, name: string): Promise<string> {
  const existing = await findUserByEmail(email);
  let userId = existing;

  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`[created] ${email} -> ${userId}`);
  } else {
    console.log(`[skip]    ${email} already exists -> ${userId}`);
  }

  // Profile row must exist before any household FK references this user
  // (GOLDEN-FIXES #7 — household tables target user_profiles, not auth.users).
  const { error: profileError } = await db
    .from('user_profiles')
    .upsert(
      { user_id: userId, name, timezone: 'Europe/London' },
      { onConflict: 'user_id' }
    );
  if (profileError) throw profileError;

  return userId;
}

async function main(): Promise<void> {
  const nannyId = await findUserByEmail(NANNY_EMAIL);
  if (!nannyId) {
    console.error(
      `${NANNY_EMAIL} not found. Run scripts/seed-test-users.ts first.`
    );
    process.exit(1);
  }

  const otherParentId = await ensureUser(OTHER_PARENT_EMAIL, 'Other Parent');

  // Household
  const { data: existing } = await db
    .from('households')
    .select('id')
    .eq('name', OTHER_HOUSEHOLD_NAME)
    .maybeSingle();

  let householdId = existing?.id ?? null;
  if (!householdId) {
    const { data, error } = await db
      .from('households')
      .insert({
        name: OTHER_HOUSEHOLD_NAME,
        timezone: 'Europe/London',
        created_by: otherParentId,
      })
      .select('id')
      .single();
    if (error) throw error;
    householdId = data.id;
    console.log(
      `[created] household ${OTHER_HOUSEHOLD_NAME} -> ${householdId}`
    );
  } else {
    console.log(`[skip]    household already exists -> ${householdId}`);
  }

  // Memberships: the other parent owns it, the SAME nanny also works here.
  // onConflict on (user_id, household_id) — the unique index that also makes
  // double-redeem safe in the API.
  const { error: memberError } = await db.from('household_members').upsert(
    [
      {
        household_id: householdId,
        user_id: otherParentId,
        role: 'owner',
        can_edit: true,
      },
      {
        household_id: householdId,
        user_id: nannyId,
        role: 'nanny',
        can_edit: false,
      },
    ],
    { onConflict: 'user_id,household_id' }
  );
  if (memberError) throw memberError;

  // A child, so there is something with a name that could leak.
  const { data: child } = await db
    .from('children')
    .select('id')
    .eq('household_id', householdId)
    .eq('name', OTHER_CHILD_NAME)
    .maybeSingle();
  if (!child) {
    const { error } = await db.from('children').insert({
      household_id: householdId,
      name: OTHER_CHILD_NAME,
      birth_date: '2021-01-01',
    });
    if (error) throw error;
  }

  // A confirmed shift, so the nanny has real busy time in this household.
  // Fixed dates, not "now" — the assertions must be reproducible.
  const startsAt = '2026-09-10T08:00:00+01:00';
  const { data: shift } = await db
    .from('shifts')
    .select('id')
    .eq('household_id', householdId)
    .eq('starts_at', startsAt)
    .maybeSingle();
  if (!shift) {
    const { error } = await db.from('shifts').insert({
      household_id: householdId,
      carer_id: nannyId,
      starts_at: startsAt,
      ends_at: '2026-09-10T17:00:00+01:00',
      timezone: 'Europe/London',
      local_date: '1900-01-01', // overwritten by the trigger; proves it fires
      kind: 'recurring',
      status: 'confirmed',
      origin: 'system_generated',
      created_by: otherParentId,
    });
    if (error) throw error;
    console.log('[created] confirmed shift in the second household');
  } else {
    console.log('[skip]    shift already exists');
  }

  const { count } = await db
    .from('household_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', nannyId)
    .eq('status', 'active');

  console.log(`\nNanny now belongs to ${count} active household(s).`);
  console.log(
    'Flow 8 (cross-family anonymity) is now meaningful rather than vacuous.'
  );
  console.log(
    `Canary strings to grep for: "${OTHER_HOUSEHOLD_NAME}", "${OTHER_CHILD_NAME}"`
  );
}

await main();
