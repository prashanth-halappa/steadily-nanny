#!/usr/bin/env bun
/**
 * Seed the two fixtures needed to unblock testing paths that live device
 * runs have never actually exercised.
 *
 * WHY
 * 1. A shift scheduled for TODAY, for the nanny, in the existing test
 *    household. The household's built pattern only produces Mon/Wed shifts,
 *    and every live E2E run so far has landed on a day the pattern doesn't
 *    cover — so the clock-in-against-a-real-shift path has only ever been
 *    exercised ad hoc (`shift_id: null`), which means `time_entries.
 *    scheduled_minutes` (frozen from the linked shift at clock-out — see
 *    supabase/migrations/017_time_tracking.sql) has NEVER actually been
 *    populated in a live run. A shift dated today makes that path reachable.
 * 2. A timesheet in `submitted` status (not `approved`). The parent's
 *    Approve button is only enabled when a timesheet is `submitted` (see
 *    `timesheetCommandService.assertActionable`) — with no such row, every
 *    screenshot of the parent's timesheet screen shows a disabled control.
 *
 * Idempotent. Safe to run repeatedly:
 *   - the shift is looked up by `local_date = today` before inserting, so
 *     running twice on the same day reuses the same row (running on a
 *     DIFFERENT day intentionally creates a new "today" shift — that's the
 *     point);
 *   - the timesheet targets a FIXED, seed-owned week (2026-01-05, a Monday
 *     well before the household's real schedule pattern or any live device
 *     testing ever touches — see the real-data survey in the PR/report this
 *     script shipped with), so it can never collide with the
 *     `timesheets_household_carer_week_idx` unique index against real data,
 *     and is looked up by week before inserting.
 *   - NEITHER fixture is ever UPDATED once it exists — this script only
 *     INSERTs missing rows and reports what it finds. In particular it never
 *     touches the household's other, real timesheet row(s): the point of a
 *     roll-up-idempotency bug is that live evidence of it is valuable and
 *     must not be quietly "fixed" by a seed script.
 *
 * Run AFTER scripts/seed-test-users.ts (needs both test accounts to exist)
 * and after the nanny has joined "Our household" (flow 4).
 *
 * Usage: bun run scripts/seed-e2e-approval-fixtures.ts
 *
 * @module scripts/seed-e2e-approval-fixtures
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
/** Both "Our household" and "LEAKCANARY the Cole household" exist in this
 *  project; the nanny belongs to both. Disambiguated below by also
 *  requiring the PARENT (not the LEAKCANARY "Other Parent") to be an owner. */
const HOUSEHOLD_NAME = 'Our household';
const TIMEZONE = 'Europe/London';

/** A Monday, chosen to sit well before the household's real schedule
 *  pattern (which starts materialising shifts in Feb 2026) and before any
 *  live device-testing activity (which lands on "today", months later) —
 *  see the module doc's idempotency note. */
const SEED_TIMESHEET_WEEK_START = '2026-01-05';
const SEED_TIMESHEET_TOTAL_MINUTES = 480; // a clean 8h, obviously synthetic

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

/**
 * The `YYYY-MM-DD` local calendar date `instant` falls on in `timeZone` —
 * same technique as `apps/api/src/domains/timesheet/utils/weekStart.ts`
 * (dependency-free, `Intl.DateTimeFormat`-based; no date library in this
 * codebase).
 */
function localDateOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Minutes to ADD to a local wall-clock reading in `timeZone` to get UTC, at the instant `utcMillis`. Mirrors `domains/schedule/services/recurrenceExpander.ts#offsetMinutesAt`. */
function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const get = (type: string): number =>
    Number(parts.find(p => p.type === type)?.value ?? '0');
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return (localAsUtc - utcMillis) / 60_000;
}

/** Convert a nominal local wall-clock date+time in `timeZone` to its UTC ISO instant — same double-conversion technique as `recurrenceExpander.ts#zonedWallTimeToUtcMillis`, correct across GMT/BST. */
function zonedWallTimeToUtcIso(
  dateStr: string,
  timeStr: string,
  timeZone: string
): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mi ?? 0, 0);
  const offset1 = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;
  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return new Date(utc).toISOString();
}

async function main(): Promise<void> {
  const nannyId = await findUserByEmail(NANNY_EMAIL);
  if (!nannyId) {
    console.error(
      `${NANNY_EMAIL} not found. Run scripts/seed-test-users.ts first.`
    );
    process.exit(1);
  }
  const parentId = await findUserByEmail(PARENT_EMAIL);
  if (!parentId) {
    console.error(
      `${PARENT_EMAIL} not found. Run scripts/seed-test-users.ts first.`
    );
    process.exit(1);
  }

  // Disambiguate from the OTHER "Our household" (the solo "Tour Parent" one,
  // which has no nanny member) by requiring an ACTIVE nanny membership too.
  const { data: candidateHouseholds, error: householdError } = await db
    .from('households')
    .select('id, name')
    .eq('name', HOUSEHOLD_NAME);
  if (householdError) throw householdError;

  let householdId: string | null = null;
  for (const candidate of candidateHouseholds ?? []) {
    const { data: membership } = await db
      .from('household_members')
      .select('user_id')
      .eq('household_id', candidate.id)
      .eq('user_id', nannyId)
      .eq('status', 'active')
      .maybeSingle();
    if (membership) {
      householdId = candidate.id;
      break;
    }
  }
  if (!householdId) {
    console.error(
      `Could not find a "${HOUSEHOLD_NAME}" household with ${NANNY_EMAIL} as an active member. ` +
        'Run scripts/seed-test-users.ts and join the household through the app first.'
    );
    process.exit(1);
  }
  console.log(`[found]   household "${HOUSEHOLD_NAME}" -> ${householdId}`);
  console.log(`[found]   nanny ${NANNY_EMAIL} -> ${nannyId}`);
  console.log(`[found]   parent ${PARENT_EMAIL} -> ${parentId}`);

  // --- Fixture 1: a shift scheduled for TODAY -------------------------------
  const today = localDateOf(new Date(), TIMEZONE);
  const { data: existingShift } = await db
    .from('shifts')
    .select('id, starts_at, ends_at, status')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('local_date', today)
    .maybeSingle();

  let todayShiftId: string;
  if (existingShift) {
    todayShiftId = existingShift.id;
    console.log(
      `[skip]    shift already exists for today (${today}) -> ${todayShiftId}`
    );
  } else {
    const startsAt = zonedWallTimeToUtcIso(today, '08:00', TIMEZONE);
    const endsAt = zonedWallTimeToUtcIso(today, '17:00', TIMEZONE);
    const { data: created, error } = await db
      .from('shifts')
      .insert({
        household_id: householdId,
        carer_id: nannyId,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: TIMEZONE,
        local_date: '1900-01-01', // overwritten by the trigger; proves it fires
        kind: 'extra', // not part of the Mon/Wed recurring pattern
        status: 'confirmed',
        origin: 'system_generated',
        created_by: parentId,
      })
      .select('id')
      .single();
    if (error) throw error;
    todayShiftId = created.id;
    console.log(
      `[created] confirmed shift for today (${today}, 08:00-17:00 ${TIMEZONE}) -> ${todayShiftId}`
    );
  }

  // --- Fixture 2: a `submitted` (not `approved`) timesheet -----------------
  const { data: existingTimesheet } = await db
    .from('timesheets')
    .select('id, status, total_minutes')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('week_start', SEED_TIMESHEET_WEEK_START)
    .maybeSingle();

  let submittedTimesheetId: string;
  if (existingTimesheet) {
    submittedTimesheetId = existingTimesheet.id;
    console.log(
      `[skip]    seed timesheet already exists for week ${SEED_TIMESHEET_WEEK_START} -> ${submittedTimesheetId} ` +
        `(status: ${existingTimesheet.status}, total_minutes: ${existingTimesheet.total_minutes})`
    );
    if (existingTimesheet.status !== 'submitted') {
      console.warn(
        '[warn]    this row is no longer "submitted" (someone/something actioned it since it was seeded) — ' +
          'NOT touching it. Delete it manually and re-run this script if you need a fresh submitted fixture.'
      );
    }
  } else {
    const { data: created, error } = await db
      .from('timesheets')
      .insert({
        household_id: householdId,
        carer_id: nannyId,
        week_start: SEED_TIMESHEET_WEEK_START,
        total_minutes: SEED_TIMESHEET_TOTAL_MINUTES,
        status: 'submitted',
      })
      .select('id')
      .single();
    if (error) throw error;
    submittedTimesheetId = created.id;
    console.log(
      `[created] submitted timesheet for week ${SEED_TIMESHEET_WEEK_START} ` +
        `(${SEED_TIMESHEET_TOTAL_MINUTES} min) -> ${submittedTimesheetId}`
    );
  }

  console.log(
    '\nDone. Fixture ids for the device-driving agent to assert against:'
  );
  console.log(`  household_id:            ${householdId}`);
  console.log(`  nanny_id:                ${nannyId}`);
  console.log(`  parent_id:               ${parentId}`);
  console.log(`  today_shift_id:          ${todayShiftId}`);
  console.log(`  submitted_timesheet_id:  ${submittedTimesheetId}`);
  console.log(
    '\nExisting real timesheet/time_entries rows (if any) were left untouched — ' +
      'this script only inserts missing fixtures, never updates.'
  );
}

await main();
