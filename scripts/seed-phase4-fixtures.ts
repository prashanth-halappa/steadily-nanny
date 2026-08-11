#!/usr/bin/env bun
/**
 * Phase 4 (§9) cross-cutting Maestro fixtures — everything flows 07–15 need
 * that the app cannot create on its own inside a test run.
 *
 * This script is ADDITIVE to (and never edits) `scripts/seed-test-users.ts`,
 * `scripts/seed-second-household.ts` and `scripts/seed-e2e-approval-fixtures.ts`.
 * Run all three first; this one assumes the parent, the nanny and the shared
 * "Our household" already exist.
 *
 * WHAT IT SEEDS, and why each one cannot come from the UI
 * ------------------------------------------------------
 * 1. CLEARS `pay_arrangements` for (Our household, nanny). `PaySetupScreen`
 *    redirects to the pay hub the moment an arrangement exists
 *    (`PaySetupScreen.tsx`'s `useEffect` → `router.replace('/settings/pay')`),
 *    so flow 07 — which is ABOUT the first-run setup form — is unreachable on
 *    a second run unless the prior arrangement is deleted. Append-only
 *    effective dating means there is no "end it" write that would do instead.
 * 2. An OVERTIME week: a submitted timesheet + a single 13-hour entry, so the
 *    CA-style daily tiers flow 07 saves (OT after 8h, double time after 12h)
 *    each produce a line. 13h = 8 regular + 4 overtime + 1 double time.
 * 3. A HOLIDAY week: `household_holidays` row for Martin Luther King, Jr. Day
 *    (2026-01-19, the third Monday of January — and the Monday the week
 *    starts on) plus a worked entry on that date. There is no holiday
 *    toggle-list UI (3-E4 owed it to 3-U1 and it never landed), so the
 *    household's observed-holiday calendar can ONLY be seeded SQL-side.
 * 4. A SECOND household with `week_starts_on = 0` (Sunday). Migration 075's
 *    column has no UI writer at all, and the whole point of flow 10 is that
 *    the Hours week anchors on Sunday for this household and Monday for the
 *    other one.
 * 5. RESETS the shared seed week (2026-01-05) to `submitted`: deletes its
 *    payments, its thread events, and clears the approval columns. Flows 11
 *    and 12 consume that week (11 approves it, 12 pays and corrects it), so
 *    without this reset the batch is a one-shot and flow 04 breaks too.
 * 6. Two cover-ask shifts TOMORROW: one already past its
 *    `cover_ask_expires_at` (flow 13a/13b, expired via the job), one with a
 *    live deadline for the nanny to decline (flow 13c). `cover_ask_expires_at`
 *    is computed server-side at ask time and cannot be backdated through the
 *    API.
 * 7. Two DRAFT households (state='draft') authored by fresh nannies, each
 *    with a pending `household_invites` code and a `proposed` terms proposal
 *    — the onboarding fixtures for flows 14 and 15. Seeded SQL-side because
 *    `/onboarding/terms` DOES NOT EXIST as a route (see the BLOCKERS note at
 *    the bottom of this header): the nanny-authors-a-terms-draft screen the
 *    invite code comes from is not reachable in the app today.
 * 8. A fresh CONFIRMED parent account for flow 14, so the nanny-first journey
 *    has a redeemer who has never seen a household.
 *
 * IDEMPOTENCY
 * Everything keyed on a stable identity is looked up before insert. The three
 * things flows MUTATE — the seed week's approval state, the cover-ask shifts,
 * the draft invites — are RESET (deleted and re-created) on every run, because
 * a flow that consumes state makes the batch non-repeatable otherwise. That is
 * the deliberate difference from `seed-e2e-approval-fixtures.ts`, which never
 * updates: this script owns rows nothing else reads, and the batch has to be
 * re-runnable to be a regression net.
 *
 * Fresh users get a RANDOM suffix per run and are never reused, so flows 14/15
 * always start from an account with no history. Prior runs' accounts are left
 * alone (they are harmless and deleting auth users cascades into rows another
 * screenshot may still reference).
 *
 * Prints `KEY=VALUE` lines the driver `eval`s — see
 * `apps/mobile/.maestro/run-phase4.sh`.
 *
 * Usage: bun run scripts/seed-phase4-fixtures.ts
 *
 * BLOCKERS FOUND (reported, not fixed):
 *  - `/onboarding/terms` is referenced by `SETUP_STEP_ROUTES.TERMS`
 *    (`domains/setup/types/index.ts`) and pushed by `DraftHomeScreen`, but
 *    `apps/mobile/src/app/onboarding/terms.tsx` does not exist. The nanny
 *    "write your terms" leg of 3-O dead-ends.
 *  - There is no holiday toggle-list UI anywhere (fixture 3 above).
 *
 * @module scripts/seed-phase4-fixtures
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl } from './localSupabaseGuard';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';
const TIMEZONE = 'Europe/London';
const CURRENCY = 'GBP';
const TEST_PASSWORD = 'SteadilyTest!2026';

/** The week `seed-e2e-approval-fixtures.ts` owns. Flows 11 and 12 act on it. */
const SEED_WEEK_START = '2026-01-05';

/** Monday. Flow 07's overtime week — one 13h day so both daily tiers fire. */
const OT_WEEK_START = '2026-01-12';
const OT_ENTRY_DATE = '2026-01-12';
const OT_ENTRY_IN = '06:00';
const OT_ENTRY_OUT = '19:00'; // 13h: 8 regular + 4 overtime + 1 double time

/**
 * Monday AND Martin Luther King, Jr. Day in 2026 (third Monday of January —
 * `US_FEDERAL_HOLIDAYS`' `nth_weekday` rule, resolved by
 * `observedHolidayDatesInRange`). Flow 09's week.
 */
const HOLIDAY_WEEK_START = '2026-01-19';
const HOLIDAY_KEY = 'martin_luther_king_jr_day';

/** Sunday. Flow 10's week in the `week_starts_on = 0` household. */
const SUNDAY_HOUSEHOLD_NAME = 'PHASE4 Sunday household';
const SUNDAY_WEEK_START = '2026-01-04';

/** `valid_from` the driver hands flow 07 — before every week above. */
const ARRANGEMENT_VALID_FROM = '2026-01-01';

const SUNDAY_RATE_MINOR = 1500;
const HOURLY_RATE_MAJOR = '15';
const WORKED_HOLIDAY_MULTIPLIER = '1.5';

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
// An EXPORTED value wins over the file: `apps/api/.env` points at PRODUCTION
// (GOLDEN-FIXES #26), so reading the file alone would make the loopback guard
// below refuse every run. Export the local stack's values instead
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

/** Create a confirmed auth user + its `user_profiles` row (FK target for every
 *  household table — GOLDEN-FIXES #7). */
async function createConfirmedUser(
  email: string,
  name: string
): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = data.user.id;
  const { error: profileError } = await db
    .from('user_profiles')
    .upsert(
      { user_id: userId, name, timezone: TIMEZONE },
      { onConflict: 'user_id' }
    );
  if (profileError) throw profileError;
  console.log(`[created] ${email} -> ${userId}`);
  return userId;
}

/** Minutes to ADD to a local wall-clock reading in `timeZone` to get UTC.
 *  Mirrors `domains/schedule/services/recurrenceExpander.ts#offsetMinutesAt`. */
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

/** Nominal local wall-clock date+time in `timeZone` → its UTC ISO instant.
 *  Same double-conversion as `recurrenceExpander.ts#zonedWallTimeToUtcMillis`. */
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
  if (offset2 !== offset1) utc = guess - offset2 * 60_000;
  return new Date(utc).toISOString();
}

function localDateOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return next.toISOString().slice(0, 10);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `XXX-XXX`, the shape `CodeEntryScreen`'s placeholder advertises and
 *  `redeem_draft_household_invite` upper-cases before matching. */
function randomInviteCode(): string {
  const pick = (): string =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)] ?? 'X';
  const group = (): string => `${pick()}${pick()}${pick()}`;
  return `${group()}-${group()}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * A submitted timesheet + one worked entry for `carer` in `household`.
 * Both are deleted and re-created, so a re-run always prices the same facts —
 * these weeks are seed-owned and nothing outside this script reads them.
 * Earnings are NOT frozen for a non-approved week (`timesheetQueryService`
 * recomputes live for anything that is not `approved`), so the breakdown the
 * flows assert reflects whatever arrangement is in force at read time.
 */
async function reseedWorkedWeek(options: {
  householdId: string;
  carerId: string;
  carerDisplayName: string;
  weekStart: string;
  entryDate: string;
  clockIn: string;
  clockOut: string;
  timezone: string;
  label: string;
}): Promise<string> {
  const {
    householdId,
    carerId,
    carerDisplayName,
    weekStart,
    entryDate,
    clockIn,
    clockOut,
    timezone,
    label,
  } = options;

  await db
    .from('time_entries')
    .delete()
    .eq('household_id', householdId)
    .eq('carer_id', carerId)
    .eq('local_date', entryDate);

  await db
    .from('timesheets')
    .delete()
    .eq('household_id', householdId)
    .eq('carer_id', carerId)
    .eq('week_start', weekStart);

  const [inH, inM] = clockIn.split(':').map(Number);
  const [outH, outM] = clockOut.split(':').map(Number);
  const totalMinutes =
    (outH ?? 0) * 60 + (outM ?? 0) - ((inH ?? 0) * 60 + (inM ?? 0));

  const { data: timesheet, error: tsError } = await db
    .from('timesheets')
    .insert({
      household_id: householdId,
      carer_id: carerId,
      week_start: weekStart,
      total_minutes: totalMinutes,
      status: 'submitted',
      carer_display_name: carerDisplayName,
    })
    .select('id')
    .single();
  if (tsError) throw tsError;

  const { data: entry, error: entryError } = await db
    .from('time_entries')
    .insert({
      household_id: householdId,
      carer_id: carerId,
      shift_id: null,
      clock_in_at: zonedWallTimeToUtcIso(entryDate, clockIn, timezone),
      clock_out_at: zonedWallTimeToUtcIso(entryDate, clockOut, timezone),
      break_minutes: 0,
      kind: 'worked',
      status: 'submitted',
      local_date: '1900-01-01', // overwritten by the trigger; proves it fires
      timezone,
      carer_display_name: carerDisplayName,
    })
    .select('id')
    .single();
  if (entryError) throw entryError;

  console.log(
    `[reseed]  ${label}: week ${weekStart}, ${entryDate} ${clockIn}-${clockOut} ` +
      `(${totalMinutes} min) -> timesheet ${timesheet.id}, entry ${entry.id}`
  );
  return timesheet.id;
}

/**
 * A draft household authored by a fresh nanny, with a pending invite code and
 * an open terms proposal — exactly the shape `redeem_draft_household_invite`
 * expects (author row must be `role='nanny'`, `status='active'`).
 */
async function seedDraftHousehold(options: {
  nannyEmail: string;
  nannyName: string;
  rateMinor: number;
  label: string;
}): Promise<{ code: string; householdId: string; nannyId: string }> {
  const { nannyEmail, nannyName, rateMinor, label } = options;
  const nannyId = await createConfirmedUser(nannyEmail, nannyName);

  const { data: household, error: hhError } = await db
    .from('households')
    .insert({
      // NULL name is legal only while `state = 'draft'`
      // (`households_live_has_name`, migration 093) — a draft has no family
      // name yet because no family has joined it.
      name: null,
      state: 'draft',
      timezone: TIMEZONE,
      currency: CURRENCY,
      created_by: nannyId,
    })
    .select('id')
    .single();
  if (hhError) throw hhError;

  const { error: memberError } = await db.from('household_members').insert({
    household_id: household.id,
    user_id: nannyId,
    role: 'nanny',
    can_edit: false,
    status: 'active',
  });
  if (memberError) throw memberError;

  const { error: proposalError } = await db.from('terms_proposals').insert({
    household_id: household.id,
    carer_id: nannyId,
    proposed_by: nannyId,
    direction: 'carer',
    status: 'proposed',
    terms: {
      rate_minor: rateMinor,
      currency: CURRENCY,
      valid_from: ARRANGEMENT_VALID_FROM,
      overtime_multiplier: 1.5,
      overtime_threshold_minutes: 2400,
    },
    carer_display_name: nannyName,
  });
  if (proposalError) throw proposalError;

  const code = randomInviteCode();
  const now = Date.now();
  const { error: inviteError } = await db.from('household_invites').insert({
    household_id: household.id,
    code,
    // A nanny's draft invite is minted with `role: 'parent'` — the redeemer is
    // the family, not another carer (`DraftHomeScreen.tsx`).
    role: 'parent',
    status: 'pending',
    invited_by: nannyId,
    expires_at: new Date(now + 30 * 86_400_000).toISOString(),
    link_expires_at: new Date(now + 7 * 86_400_000).toISOString(),
  });
  if (inviteError) throw inviteError;

  console.log(
    `[created] ${label}: draft household ${household.id}, author ${nannyEmail}, code ${code}`
  );
  return { code, householdId: household.id, nannyId };
}

async function main(): Promise<void> {
  const nannyId = await findUserByEmail(NANNY_EMAIL);
  const parentId = await findUserByEmail(PARENT_EMAIL);
  if (!nannyId || !parentId) {
    console.error(
      'parent/nanny test accounts missing. Run scripts/seed-test-users.ts first.'
    );
    process.exit(1);
  }

  // Same disambiguation as seed-e2e-approval-fixtures: several households are
  // called "Our household"; the one under test is the one the NANNY is an
  // active member of.
  const { data: candidates, error: hhError } = await db
    .from('households')
    .select('id')
    .eq('name', HOUSEHOLD_NAME);
  if (hhError) throw hhError;

  let householdId: string | null = null;
  for (const candidate of candidates ?? []) {
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
      `No "${HOUSEHOLD_NAME}" with ${NANNY_EMAIL} as an active member. ` +
        'Run scripts/seed-e2e-approval-fixtures.ts prerequisites first.'
    );
    process.exit(1);
  }
  console.log(`[found]   household -> ${householdId}`);

  // --- 1. Clear arrangements so flow 07's setup screen is reachable --------
  const { data: clearedArrangements, error: clearError } = await db
    .from('pay_arrangements')
    .delete()
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .select('id');
  if (clearError) throw clearError;
  console.log(
    `[reset]   deleted ${clearedArrangements?.length ?? 0} pay_arrangements ` +
      '(PaySetupScreen redirects to the hub while one exists)'
  );

  // --- 2. Overtime week ----------------------------------------------------
  await reseedWorkedWeek({
    householdId,
    carerId: nannyId,
    carerDisplayName: 'Test Nanny',
    weekStart: OT_WEEK_START,
    entryDate: OT_ENTRY_DATE,
    clockIn: OT_ENTRY_IN,
    clockOut: OT_ENTRY_OUT,
    timezone: TIMEZONE,
    label: 'overtime week (flow 07)',
  });

  // --- 3. Holiday week -----------------------------------------------------
  const { error: holidayError } = await db.from('household_holidays').upsert(
    {
      household_id: householdId,
      holiday_key: HOLIDAY_KEY,
      observed: true,
    },
    { onConflict: 'household_id,holiday_key' }
  );
  if (holidayError) throw holidayError;
  console.log(
    `[ok]      household_holidays observed: ${HOLIDAY_KEY} ` +
      `(resolves to ${HOLIDAY_WEEK_START} in 2026)`
  );

  await reseedWorkedWeek({
    householdId,
    carerId: nannyId,
    carerDisplayName: 'Test Nanny',
    weekStart: HOLIDAY_WEEK_START,
    entryDate: HOLIDAY_WEEK_START,
    clockIn: '09:00',
    clockOut: '17:00',
    timezone: TIMEZONE,
    label: 'holiday week (flow 09)',
  });

  // --- 4. Sunday-workweek household ---------------------------------------
  const { data: existingSunday } = await db
    .from('households')
    .select('id')
    .eq('name', SUNDAY_HOUSEHOLD_NAME)
    .maybeSingle();

  let sundayHouseholdId = existingSunday?.id ?? null;
  if (!sundayHouseholdId) {
    const { data: created, error } = await db
      .from('households')
      .insert({
        name: SUNDAY_HOUSEHOLD_NAME,
        timezone: TIMEZONE,
        currency: CURRENCY,
        // 0 = Sunday (migration 075; 0=Sun..6=Sat, default 1=Monday). No UI
        // writes this column — the API resolves every week boundary from it.
        week_starts_on: 0,
        created_by: parentId,
      })
      .select('id')
      .single();
    if (error) throw error;
    sundayHouseholdId = created.id;
    console.log(`[created] Sunday household -> ${sundayHouseholdId}`);
  } else {
    console.log(`[skip]    Sunday household exists -> ${sundayHouseholdId}`);
  }

  const { error: sundayMembersError } = await db
    .from('household_members')
    .upsert(
      [
        {
          household_id: sundayHouseholdId,
          user_id: parentId,
          role: 'owner',
          can_edit: true,
          status: 'active',
        },
        {
          household_id: sundayHouseholdId,
          user_id: nannyId,
          role: 'nanny',
          can_edit: false,
          status: 'active',
        },
      ],
      { onConflict: 'user_id,household_id' }
    );
  if (sundayMembersError) throw sundayMembersError;

  const { data: sundayArrangement } = await db
    .from('pay_arrangements')
    .select('id')
    .eq('household_id', sundayHouseholdId)
    .eq('carer_id', nannyId)
    .maybeSingle();
  if (!sundayArrangement) {
    const { error } = await db.from('pay_arrangements').insert({
      household_id: sundayHouseholdId,
      carer_id: nannyId,
      rate_minor: SUNDAY_RATE_MINOR,
      currency: CURRENCY,
      valid_from: ARRANGEMENT_VALID_FROM,
      carer_display_name: 'Test Nanny',
      created_by: parentId,
    });
    if (error) throw error;
    console.log('[created] Sunday household arrangement');
  }

  await reseedWorkedWeek({
    householdId: sundayHouseholdId,
    carerId: nannyId,
    carerDisplayName: 'Test Nanny',
    weekStart: SUNDAY_WEEK_START,
    entryDate: SUNDAY_WEEK_START,
    clockIn: '09:00',
    clockOut: '17:00',
    timezone: TIMEZONE,
    label: 'Sunday week (flow 10)',
  });

  // --- 5. Reset the shared seed week to `submitted` ------------------------
  // Flow 11 approves it and flow 12 pays + corrects it. Without this the whole
  // batch — and flow 04, which also needs a submitted week — is single-use.
  const { data: seedTimesheet } = await db
    .from('timesheets')
    .select('id')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('week_start', SEED_WEEK_START)
    .maybeSingle();

  if (seedTimesheet) {
    const { error: paymentsError } = await db
      .from('payments')
      .delete()
      .eq('timesheet_id', seedTimesheet.id);
    if (paymentsError) throw paymentsError;

    // Week-thread messages are `shift_events` rows with `shift_id = null` and
    // `local_date = timesheets.week_start` (`weekThread.ts` — there is no
    // thread table). Clearing them puts flow 11 back at an empty thread.
    const { error: eventsError } = await db
      .from('shift_events')
      .delete()
      .eq('household_id', householdId)
      .eq('local_date', SEED_WEEK_START)
      .is('shift_id', null);
    if (eventsError) throw eventsError;

    const { error: resetError } = await db
      .from('timesheets')
      .update({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        query_note: null,
        reopen_reason: null,
        earnings: null,
        earnings_computed_at: null,
        gross_minor: null,
      })
      .eq('id', seedTimesheet.id);
    if (resetError) throw resetError;

    const { error: entryResetError } = await db
      .from('time_entries')
      .update({ status: 'submitted' })
      .eq('household_id', householdId)
      .eq('carer_id', nannyId)
      .gte('local_date', SEED_WEEK_START)
      .lt('local_date', addDaysISO(SEED_WEEK_START, 7))
      .neq('status', 'voided');
    if (entryResetError) throw entryResetError;

    console.log(
      `[reset]   seed week ${SEED_WEEK_START} -> submitted ` +
        '(payments, thread events and approval columns cleared)'
    );
  } else {
    console.log(
      `[warn]    no seed timesheet for ${SEED_WEEK_START} — run ` +
        'scripts/seed-e2e-approval-fixtures.ts first (flows 11/12 need it)'
    );
  }

  // --- 6. Cover-ask shifts, tomorrow --------------------------------------
  // TOMORROW, not today, deliberately: `seed-e2e-approval-fixtures.ts` looks
  // its today-shift up with `.eq('local_date', today).maybeSingle()`, which
  // throws the moment a second shift shares that date. Seeding these on today
  // would break the other seeder.
  const tomorrow = addDaysISO(localDateOf(new Date(), TIMEZONE), 1);

  const { error: coverClearError } = await db
    .from('shifts')
    .delete()
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('local_date', tomorrow)
    .eq('kind', 'cover');
  if (coverClearError) throw coverClearError;

  // Expired ask: `cover_ask_expires_at` in the past while still `pending`, so
  // the nanny sees the M21 deadline before the job runs and the expired state
  // after it. The API computes this column at ask time and never backdates it.
  const { data: expiredAsk, error: expiredAskError } = await db
    .from('shifts')
    .insert({
      household_id: householdId,
      carer_id: nannyId,
      starts_at: zonedWallTimeToUtcIso(tomorrow, '18:00', TIMEZONE),
      ends_at: zonedWallTimeToUtcIso(tomorrow, '21:00', TIMEZONE),
      timezone: TIMEZONE,
      local_date: '1900-01-01', // overwritten by the trigger
      kind: 'cover',
      status: 'pending',
      origin: 'parent_proposed',
      sequence: 0,
      cover_ask_expires_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      created_by: parentId,
    })
    .select('id')
    .single();
  if (expiredAskError) throw expiredAskError;

  const { data: declineAsk, error: declineAskError } = await db
    .from('shifts')
    .insert({
      household_id: householdId,
      carer_id: nannyId,
      starts_at: zonedWallTimeToUtcIso(tomorrow, '21:30', TIMEZONE),
      ends_at: zonedWallTimeToUtcIso(tomorrow, '22:30', TIMEZONE),
      timezone: TIMEZONE,
      local_date: '1900-01-01',
      kind: 'cover',
      status: 'pending',
      origin: 'parent_proposed',
      sequence: 0,
      // Live deadline — this one must SURVIVE the expiry job so the nanny can
      // decline it in flow 13c.
      cover_ask_expires_at: new Date(
        Date.now() + 12 * 60 * 60_000
      ).toISOString(),
      created_by: parentId,
    })
    .select('id')
    .single();
  if (declineAskError) throw declineAskError;

  console.log(
    `[created] cover asks on ${tomorrow}: expired ${expiredAsk.id}, decline ${declineAsk.id}`
  );

  // --- 6b. Sick-day fixture reset (flow 08) --------------------------------
  // `SickTimeOffButton` books TODAY, all day, and per D-23 the server opens a
  // `cancel` change request against every overlapping shift. Re-running the
  // flow needs three things back at their start state: no sick row for today,
  // no leftover change request, and the today-shift `confirmed` again.
  const today = localDateOf(new Date(), TIMEZONE);
  const todayEndUtc = zonedWallTimeToUtcIso(
    addDaysISO(today, 1),
    '00:00',
    TIMEZONE
  );
  const todayStartUtc = zonedWallTimeToUtcIso(today, '00:00', TIMEZONE);

  const { error: timeOffClearError } = await db
    .from('carer_time_off')
    .delete()
    .eq('user_id', nannyId)
    .lt('starts_at', todayEndUtc)
    .gt('ends_at', todayStartUtc);
  if (timeOffClearError) throw timeOffClearError;

  const { data: todayShift } = await db
    .from('shifts')
    .select('id')
    .eq('household_id', householdId)
    .eq('carer_id', nannyId)
    .eq('local_date', today)
    .eq('kind', 'extra')
    .maybeSingle();

  if (todayShift) {
    const { error: crClearError } = await db
      .from('shift_change_requests')
      .delete()
      .eq('shift_id', todayShift.id);
    if (crClearError) throw crClearError;

    const { error: shiftResetError } = await db
      .from('shifts')
      .update({
        status: 'confirmed',
        cancelled_at: null,
        cancelled_by: null,
        cancellation_paid: false,
        cancellation_message: null,
      })
      .eq('id', todayShift.id);
    if (shiftResetError) throw shiftResetError;
    console.log(
      `[reset]   today's shift ${todayShift.id} -> confirmed, sick day + change requests cleared`
    );
  } else {
    console.log(
      `[warn]    no today-shift (${today}) for the nanny — run ` +
        'scripts/seed-e2e-approval-fixtures.ts today (flow 08 needs it)'
    );
  }

  // --- 7/8. Onboarding fixtures -------------------------------------------
  const suffix = randomSuffix();
  const freshParentEmail = `phase4-parent-${suffix}@steadilynanny.test`;
  const freshParentId = await createConfirmedUser(
    freshParentEmail,
    'Phase4 Fresh Parent'
  );

  const draftA = await seedDraftHousehold({
    nannyEmail: `phase4-nanny-a-${suffix}@steadilynanny.test`,
    nannyName: 'Phase4 Nanny A',
    rateMinor: 1800,
    label: 'flow 14 draft',
  });
  const draftB = await seedDraftHousehold({
    nannyEmail: `phase4-nanny-b-${suffix}@steadilynanny.test`,
    nannyName: 'Phase4 Nanny B',
    rateMinor: 1900,
    label: 'flow 15 draft (absorption)',
  });

  // --- Driver contract -----------------------------------------------------
  console.log('\n# --- eval me (run-phase4.sh) ---');
  console.log(`PHASE4_HOUSEHOLD_ID=${householdId}`);
  console.log(`PHASE4_NANNY_ID=${nannyId}`);
  console.log(`PHASE4_PARENT_ID=${parentId}`);
  console.log(`PHASE4_SEED_WEEK_START=${SEED_WEEK_START}`);
  console.log(`PHASE4_OT_WEEK_START=${OT_WEEK_START}`);
  console.log(`PHASE4_HOLIDAY_WEEK_START=${HOLIDAY_WEEK_START}`);
  console.log(`PHASE4_SUNDAY_HOUSEHOLD_ID=${sundayHouseholdId}`);
  console.log(`PHASE4_SUNDAY_WEEK_START=${SUNDAY_WEEK_START}`);
  console.log(`PHASE4_ARRANGEMENT_VALID_FROM=${ARRANGEMENT_VALID_FROM}`);
  console.log(`PHASE4_HOURLY_RATE=${HOURLY_RATE_MAJOR}`);
  console.log(`PHASE4_HOLIDAY_MULTIPLIER=${WORKED_HOLIDAY_MULTIPLIER}`);
  console.log(`PHASE4_TODAY_SHIFT_ID=${todayShift?.id ?? ''}`);
  console.log(`PHASE4_EXPIRED_ASK_SHIFT_ID=${expiredAsk.id}`);
  console.log(`PHASE4_DECLINE_ASK_SHIFT_ID=${declineAsk.id}`);
  console.log(`PHASE4_NEW_PARENT_EMAIL=${freshParentEmail}`);
  console.log(`PHASE4_NEW_PARENT_ID=${freshParentId}`);
  console.log(`PHASE4_DRAFT_CODE_A=${draftA.code}`);
  console.log(`PHASE4_DRAFT_HOUSEHOLD_A=${draftA.householdId}`);
  console.log(`PHASE4_DRAFT_CODE_B=${draftB.code}`);
  console.log(`PHASE4_DRAFT_HOUSEHOLD_B=${draftB.householdId}`);
}

await main();
