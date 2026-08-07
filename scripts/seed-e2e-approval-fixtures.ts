#!/usr/bin/env bun
/**
 * Seed the fixtures needed to unblock testing paths that live device runs
 * have never actually exercised, and that the Maestro E2E suite
 * (apps/mobile/.maestro/) needs IDs for (EXTRA_SHIFT_ID / DEMOTED_SHIFT_ID /
 * TIME_ENTRY_ID in apps/mobile/.env.maestro).
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
 * 3. A PENDING extra shift assigned to the nanny (EXTRA_SHIFT_ID) — Maestro
 *    flow 02 deep-links straight to it and taps Accept.
 * 4. A CONFIRMED shift the parent can edit (DEMOTED_SHIFT_ID) — flow 03's
 *    parent leg edits its time (demoting it to pending, migration 034), then
 *    the nanny leg re-confirms it.
 * 5. An EDITABLE time entry inside the same `submitted` week as fixture 2
 *    (TIME_ENTRY_ID) — flow 04's nanny leg opens it via the correction sheet.
 *
 * Idempotent. Safe to run repeatedly:
 *   - fixtures 1/2 are looked up by a stable key (today's local_date; the
 *     fixed seed week) before inserting, so a second run on the same day /
 *     against the same week reuses the same row instead of duplicating it;
 *   - fixtures 3/4/5 live in the SAME fixed, seed-owned week as fixture 2
 *     (2026-01-05, a Monday well before the household's real schedule
 *     pattern or any live device testing ever touches — see the real-data
 *     survey in the PR/report this script shipped with), so none of them
 *     can collide with real household data either;
 *   - NEITHER fixture is ever UPDATED once it exists — this script only
 *     INSERTs missing rows and reports what it finds. In particular it never
 *     touches the household's other, real timesheet row(s): the point of a
 *     roll-up-idempotency bug is that live evidence of it is valuable and
 *     must not be quietly "fixed" by a seed script. Fixtures 3/4/5 are
 *     test-owned (the whole point is that Maestro flows 02/03/04 mutate
 *     their status), so once a live E2E run has actioned one, re-running
 *     this script prints a `[warn]` — same as fixture 2 — rather than
 *     silently resetting evidence of what actually happened; re-seed a
 *     fresh run by deleting the row.
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
import { assertLocalSupabaseUrl } from './localSupabaseGuard';

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

/** Wednesday of the seed week — EXTRA_SHIFT_ID (flow 02: nanny accepts). */
const SEED_EXTRA_SHIFT_LOCAL_DATE = '2026-01-07';
/** Thursday of the seed week — DEMOTED_SHIFT_ID (flow 03: parent edits a
 *  confirmed shift, demoting it; nanny re-confirms). `kind: 'cover'` (not
 *  `'extra'`) so ShiftDetailScreen's `isFreshExtraProposal` check can never
 *  match it after the demote — it must show the re-confirm copy, not the
 *  fresh-proposal copy (see that screen's header comment). */
const SEED_DEMOTED_SHIFT_LOCAL_DATE = '2026-01-08';
/** Tuesday of the seed week — TIME_ENTRY_ID (flow 04: nanny corrects the
 *  "Tuesday clock-out" the parent queried). Same week as fixture 2 so it's
 *  editable (`status: 'submitted'`) for as long as that timesheet is. */
const SEED_TIME_ENTRY_LOCAL_DATE = '2026-01-06';

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
    console.log(
      `[skip]    Could not find a "${HOUSEHOLD_NAME}" household with ${NANNY_EMAIL} as an active member. ` +
        'Run scripts/seed-test-users.ts, create the household and join it through the app (flow 4), then re-run this script.'
    );
    process.exit(0);
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

  // --- Fixture 3: EXTRA_SHIFT_ID — pending extra shift, assigned to nanny --
  // Maestro flow 02 (nanny-accept-extra-shift) deep-links straight to this
  // and taps Accept, mirroring the EXTRA_SHIFT_PROPOSED push route.
  const { data: existingExtraShift } = await db
    .from('shifts')
    .select('id, status')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('local_date', SEED_EXTRA_SHIFT_LOCAL_DATE)
    .eq('kind', 'extra')
    .maybeSingle();

  let extraShiftId: string;
  if (existingExtraShift) {
    extraShiftId = existingExtraShift.id;
    console.log(
      `[skip]    extra shift fixture already exists (${SEED_EXTRA_SHIFT_LOCAL_DATE}) -> ${extraShiftId} ` +
        `(status: ${existingExtraShift.status})`
    );
    if (existingExtraShift.status !== 'pending') {
      console.warn(
        '[warn]    this row is no longer "pending" (a previous E2E run likely accepted it) — ' +
          'NOT touching it. Delete it manually and re-run this script if you need a fresh pending fixture.'
      );
    }
  } else {
    const startsAt = zonedWallTimeToUtcIso(
      SEED_EXTRA_SHIFT_LOCAL_DATE,
      '08:00',
      TIMEZONE
    );
    const endsAt = zonedWallTimeToUtcIso(
      SEED_EXTRA_SHIFT_LOCAL_DATE,
      '13:00',
      TIMEZONE
    );
    const { data: created, error } = await db
      .from('shifts')
      .insert({
        household_id: householdId,
        carer_id: nannyId,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: TIMEZONE,
        local_date: '1900-01-01', // overwritten by the trigger
        kind: 'extra',
        status: 'pending',
        origin: 'parent_proposed',
        sequence: 0,
        created_by: parentId,
      })
      .select('id')
      .single();
    if (error) throw error;
    extraShiftId = created.id;
    console.log(
      `[created] pending extra shift (${SEED_EXTRA_SHIFT_LOCAL_DATE}, 08:00-13:00 ${TIMEZONE}) -> ${extraShiftId}`
    );
  }

  // --- Fixture 4: DEMOTED_SHIFT_ID — confirmed shift the parent can edit ---
  // Maestro flow 03 (parent-edit-demote-reconfirm): parent Save demotes this
  // to pending + parent_proposed (migration 034), nanny leg re-confirms it.
  // `kind: 'cover'` (never `'extra'`) so the demoted row can only ever read
  // as "needs reconfirm", never "fresh proposal" — see the constant's doc.
  const { data: existingDemotedShift } = await db
    .from('shifts')
    .select('id, status')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('local_date', SEED_DEMOTED_SHIFT_LOCAL_DATE)
    .eq('kind', 'cover')
    .maybeSingle();

  let demotedShiftId: string;
  if (existingDemotedShift) {
    demotedShiftId = existingDemotedShift.id;
    console.log(
      `[skip]    demoted-shift fixture already exists (${SEED_DEMOTED_SHIFT_LOCAL_DATE}) -> ${demotedShiftId} ` +
        `(status: ${existingDemotedShift.status})`
    );
    if (existingDemotedShift.status !== 'confirmed') {
      console.warn(
        '[warn]    this row is no longer "confirmed" (a previous E2E run likely edited it and it was left ' +
          'mid-flow) — NOT touching it. Delete it manually and re-run this script if you need a fresh confirmed fixture.'
      );
    }
  } else {
    const startsAt = zonedWallTimeToUtcIso(
      SEED_DEMOTED_SHIFT_LOCAL_DATE,
      '09:00',
      TIMEZONE
    );
    const endsAt = zonedWallTimeToUtcIso(
      SEED_DEMOTED_SHIFT_LOCAL_DATE,
      '17:00',
      TIMEZONE
    );
    const { data: created, error } = await db
      .from('shifts')
      .insert({
        household_id: householdId,
        carer_id: nannyId,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: TIMEZONE,
        local_date: '1900-01-01', // overwritten by the trigger
        kind: 'cover',
        status: 'confirmed',
        origin: 'system_generated',
        sequence: 0,
        created_by: parentId,
      })
      .select('id')
      .single();
    if (error) throw error;
    demotedShiftId = created.id;
    console.log(
      `[created] confirmed shift (${SEED_DEMOTED_SHIFT_LOCAL_DATE}, 09:00-17:00 ${TIMEZONE}) -> ${demotedShiftId}`
    );
  }

  // --- Fixture 5: TIME_ENTRY_ID — editable entry in the submitted week ----
  // Maestro flow 04 (nanny leg): opens ClockOutSheet in edit mode via
  // `hours-edit-entry-${TIME_ENTRY_ID}`, which requires `status: 'submitted'`
  // (see `isEntryEditable` in apps/mobile's timesheet/utils/entryEdited.ts)
  // and a timesheet week that isn't yet approved — both true for fixture 2
  // until flow 04's own parent leg approves it.
  const { data: existingTimeEntry } = await db
    .from('time_entries')
    .select('id, status')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('local_date', SEED_TIME_ENTRY_LOCAL_DATE)
    .maybeSingle();

  let timeEntryId: string;
  if (existingTimeEntry) {
    timeEntryId = existingTimeEntry.id;
    console.log(
      `[skip]    time entry fixture already exists (${SEED_TIME_ENTRY_LOCAL_DATE}) -> ${timeEntryId} ` +
        `(status: ${existingTimeEntry.status})`
    );
    if (existingTimeEntry.status !== 'submitted') {
      console.warn(
        '[warn]    this row is no longer "submitted" — NOT touching it. Delete it manually and re-run ' +
          'this script if you need a fresh editable fixture.'
      );
    }
  } else {
    const clockInAt = zonedWallTimeToUtcIso(
      SEED_TIME_ENTRY_LOCAL_DATE,
      '09:00',
      TIMEZONE
    );
    const clockOutAt = zonedWallTimeToUtcIso(
      SEED_TIME_ENTRY_LOCAL_DATE,
      '17:00',
      TIMEZONE
    );
    const { data: created, error } = await db
      .from('time_entries')
      .insert({
        household_id: householdId,
        carer_id: nannyId,
        shift_id: null,
        clock_in_at: clockInAt,
        clock_out_at: clockOutAt,
        break_minutes: 0,
        kind: 'worked',
        status: 'submitted',
        local_date: '1900-01-01', // overwritten by the trigger
        timezone: TIMEZONE,
      })
      .select('id')
      .single();
    if (error) throw error;
    timeEntryId = created.id;
    console.log(
      `[created] submitted time entry (${SEED_TIME_ENTRY_LOCAL_DATE}, 09:00-17:00 ${TIMEZONE}) -> ${timeEntryId}`
    );
  }

  console.log(
    '\nDone. Fixture ids for the device-driving agent to assert against ' +
      '(paste EXTRA_SHIFT_ID / DEMOTED_SHIFT_ID / TIME_ENTRY_ID into apps/mobile/.env.maestro):'
  );
  console.log(`  household_id:            ${householdId}`);
  console.log(`  nanny_id:                ${nannyId}`);
  console.log(`  parent_id:               ${parentId}`);
  console.log(`  today_shift_id:          ${todayShiftId}`);
  console.log(`  submitted_timesheet_id:  ${submittedTimesheetId}`);
  console.log(`  EXTRA_SHIFT_ID:          ${extraShiftId}`);
  console.log(`  DEMOTED_SHIFT_ID:        ${demotedShiftId}`);
  console.log(`  TIME_ENTRY_ID:           ${timeEntryId}`);
  console.log(
    '\nExisting real timesheet/shifts/time_entries rows (if any) were left untouched — ' +
      'this script only inserts missing fixtures, never updates.'
  );
}

await main();
