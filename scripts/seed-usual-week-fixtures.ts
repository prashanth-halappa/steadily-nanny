#!/usr/bin/env bun
/**
 * Seed a household in the exact pre-condition the "usual week handoff"
 * Maestro flow needs: nanny joined, pay terms agreed, care hours typed for
 * a child, and DELIBERATELY no schedule_pattern and no shifts. That is the
 * state `WeeklyHoursNotSetCard` / `SchedulePatternBanner` / `NoWeekYetCard`
 * all key off (see their module docs).
 *
 * Terms are seeded by inserting `pay_arrangements` directly, the same
 * shortcut `seed-phase4-fixtures.ts` already uses for the Sunday household
 * — the read side only checks `!!arrangement.data`, not how the row got
 * there (commit 9fa858e only removed the APP's direct-write path, not the
 * DB's).
 *
 * `child_commitments` (weekday 07:00-13:00 — every row is a declared need
 * window since migration 070 dropped `excluded_from_cover`) does double
 * duty: it is what `hydrateFromCommitments` prefills the builder's Review
 * step from, AND — because nothing covers those hours yet — what makes
 * `uncoveredWeek.totalCount > 0` so the agenda's per-day uncovered rows
 * have something to show (scenario E).
 *
 * Idempotent AND re-runnable mid-suite: always resets schedule_patterns and
 * shifts for this household back to empty, so re-running before a Maestro
 * pass undoes whatever the previous pass sent.
 *
 * Usage: bun run scripts/seed-usual-week-fixtures.ts
 * Prereqs: scripts/seed-test-users.ts (PARENT_EMAIL / NANNY_EMAIL exist).
 *
 * @module scripts/seed-usual-week-fixtures
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl } from './localSupabaseGuard';

const PARENT_EMAIL = 'parent@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';

const HOUSEHOLD_NAME = 'Usual Week household';
const CHILD_NAME = 'Usual Week Kid';
const RATE_MINOR = 1800; // $18.00/hr
const CURRENCY = 'USD';
const ARRANGEMENT_VALID_FROM = '2026-01-01';
const TIMEZONE = 'America/Los_Angeles';

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
// An EXPORTED value wins over the file — apps/api/.env points at PRODUCTION
// (GOLDEN-FIXES #26), so reading the file alone would make the loopback
// guard below refuse the run. Export the local stack's values instead
// (`supabase status -o env`).
const fileEnv = loadEnvFile(join(repoRoot, 'apps/api/.env'));
const url = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_KEY ?? fileEnv.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey || serviceKey.startsWith('SET-ME')) {
  console.error(
    'Missing or placeholder SUPABASE_URL / SUPABASE_SERVICE_KEY — export them (see `supabase status -o env`) or set them in apps/api/.env'
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

async function main(): Promise<void> {
  const parentId = await findUserByEmail(PARENT_EMAIL);
  const nannyId = await findUserByEmail(NANNY_EMAIL);
  if (!parentId || !nannyId) {
    console.error(
      `${PARENT_EMAIL} / ${NANNY_EMAIL} not found. Run scripts/seed-test-users.ts first.`
    );
    process.exit(1);
  }

  // --- household -----------------------------------------------------------
  const { data: existing } = await db
    .from('households')
    .select('id')
    .eq('name', HOUSEHOLD_NAME)
    .eq('created_by', parentId)
    .maybeSingle();

  let householdId = existing?.id ?? null;
  if (!householdId) {
    const { data, error } = await db
      .from('households')
      .insert({
        name: HOUSEHOLD_NAME,
        timezone: TIMEZONE,
        created_by: parentId,
      })
      .select('id')
      .single();
    if (error) throw error;
    householdId = data.id;
    console.log(`[created] household ${HOUSEHOLD_NAME} -> ${householdId}`);
  } else {
    console.log(`[skip]    household already exists -> ${householdId}`);
  }

  // `joined_at` backdated well past `JOINED_CARD_MAX_AGE_MS` (7 days, both
  // `WeeklyHoursNotSetCard` and `NoWeekYetCard`) — a fresh `joined_at` makes
  // the nanny-joined welcome moment show INSTEAD of the card under test on
  // both sides (`momentShowing` / `joinedCardShowing`), which is correct app
  // behaviour but not what this fixture is for.
  const JOINED_AT = '2026-06-01T00:00:00Z';
  const { error: memberError } = await db.from('household_members').upsert(
    [
      {
        household_id: householdId,
        user_id: parentId,
        role: 'owner',
        can_edit: true,
        status: 'active',
        joined_at: JOINED_AT,
      },
      {
        household_id: householdId,
        user_id: nannyId,
        role: 'nanny',
        can_edit: false,
        status: 'active',
        joined_at: JOINED_AT,
      },
    ],
    { onConflict: 'user_id,household_id' }
  );
  if (memberError) throw memberError;

  // --- child + care hours ----------------------------------------------------
  const { data: existingChild } = await db
    .from('children')
    .select('id')
    .eq('household_id', householdId)
    .eq('name', CHILD_NAME)
    .maybeSingle();

  let childId = existingChild?.id ?? null;
  if (!childId) {
    const { data, error } = await db
      .from('children')
      .insert({
        household_id: householdId,
        name: CHILD_NAME,
        avatar_initial: 'U',
      })
      .select('id')
      .single();
    if (error) throw error;
    childId = data.id;
    console.log('[created] child');
  } else {
    console.log('[skip]    child already exists');
  }

  const { data: existingCommitment } = await db
    .from('child_commitments')
    .select('id')
    .eq('child_id', childId)
    .eq('label', 'Care hours')
    .maybeSingle();
  if (!existingCommitment) {
    const { error } = await db.from('child_commitments').insert({
      child_id: childId,
      household_id: householdId,
      kind: 'other',
      label: 'Care hours',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      start_time: '07:00',
      end_time: '13:00',
    });
    if (error) throw error;
    console.log('[created] weekday 07:00-13:00 care-hours commitment');
  } else {
    console.log('[skip]    care-hours commitment already exists');
  }

  // --- terms agreed (direct write — see module doc) --------------------------
  const { data: existingArrangement } = await db
    .from('pay_arrangements')
    .select('id')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .maybeSingle();
  if (!existingArrangement) {
    const { error } = await db.from('pay_arrangements').insert({
      household_id: householdId,
      carer_id: nannyId,
      rate_minor: RATE_MINOR,
      currency: CURRENCY,
      valid_from: ARRANGEMENT_VALID_FROM,
      carer_display_name: 'Test Nanny',
      created_by: parentId,
    });
    if (error) throw error;
    console.log('[created] pay arrangement (terms agreed)');
  } else {
    console.log('[skip]    pay arrangement already exists');
  }

  // --- reset: no schedule pattern, no shifts ---------------------------------
  // Re-runnable: undoes whatever a PRIOR Maestro pass sent, so the household
  // is back at "terms agreed, nothing scheduled" every time this script runs.
  const { data: patterns, error: patternsSelectError } = await db
    .from('schedule_patterns')
    .select('id')
    .eq('household_id', householdId);
  if (patternsSelectError) throw patternsSelectError;
  if (patterns && patterns.length > 0) {
    const { error } = await db
      .from('schedule_patterns')
      .delete()
      .eq('household_id', householdId);
    if (error) throw error;
    console.log(`[reset]   deleted ${patterns.length} schedule_pattern(s)`);
  }

  const { data: shifts, error: shiftsSelectError } = await db
    .from('shifts')
    .select('id')
    .eq('household_id', householdId);
  if (shiftsSelectError) throw shiftsSelectError;
  if (shifts && shifts.length > 0) {
    const { error } = await db
      .from('shifts')
      .delete()
      .eq('household_id', householdId);
    if (error) throw error;
    console.log(`[reset]   deleted ${shifts.length} shift(s)`);
  }

  console.log('\n# --- eval me ---------------------------------------------');
  console.log(`USUAL_WEEK_HOUSEHOLD_ID=${householdId}`);
  console.log(`USUAL_WEEK_NANNY_ID=${nannyId}`);
  console.log(`USUAL_WEEK_PARENT_ID=${parentId}`);
}

await main();
