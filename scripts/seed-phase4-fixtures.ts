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
 * 9. Two more fresh CONFIRMED (parent, nanny) pairs, neither with a household
 *    — flows 16 (P8 pay-offer + B1 carer-accept) and 17 (B4 decline) each
 *    drive the whole thing live (household, invite, offer all minted through
 *    the app), so all they need from here is bare accounts.
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

import { and, desc, eq, gt, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  carerTimeOff,
  children,
  householdHolidays,
  householdInvites,
  householdMembers,
  households,
  payArrangements,
  payments,
  shiftChangeRequests,
  shiftEvents,
  shifts,
  termsProposals,
  timeEntries,
  timesheets,
  user,
  userProfiles,
} from '../apps/api/src/db/schema';
import { ensureUser, getLocalDb } from './lib/localDb';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';
/**
 * The zone for households this script CREATES (the Sunday household, the two
 * drafts) and for the throwaway user profiles it mints.
 *
 * It is NOT the zone for rows written into the SHARED seed household — those
 * use `households.timezone`, read at run time. Hardcoding one zone for both is
 * what made flow 08 undrivable: with the shared household on
 * America/Los_Angeles, a London "today" rolls over eight hours early, so on
 * any evening run this script reset TOMORROW's shift and handed the flow an id
 * for a shift the app does not consider today at all.
 */
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

async function findUserByEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

/** Create a confirmed Better Auth user + its `user_profiles` row (FK target
 *  for every household table — GOLDEN-FIXES #7). */
async function createConfirmedUser(
  db: Db,
  email: string,
  name: string
): Promise<string> {
  const { id: userId } = await ensureUser(db, {
    email,
    password: TEST_PASSWORD,
    name,
  });
  await db
    .insert(userProfiles)
    .values({ user_id: userId, name, timezone: TIMEZONE })
    .onConflictDoUpdate({
      target: userProfiles.user_id,
      set: { name, timezone: TIMEZONE },
    });
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

/** Inverse of `zonedWallTimeToUtcIso`: a UTC instant → its `HH:MM` wall time in
 *  `timeZone`. Used to move a fixture shift to another DATE while keeping the
 *  time of day the household actually sees — re-deriving the wall time is what
 *  keeps that correct across a DST boundary, where adding a 24h delta to the
 *  stored UTC would drift by an hour. */
function utcIsoToZonedWallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
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
async function reseedWorkedWeek(
  db: Db,
  options: {
    householdId: string;
    carerId: string;
    carerDisplayName: string;
    weekStart: string;
    entryDate: string;
    clockIn: string;
    clockOut: string;
    timezone: string;
    label: string;
  }
): Promise<string> {
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
    .delete(timeEntries)
    .where(
      and(
        eq(timeEntries.household_id, householdId),
        eq(timeEntries.carer_id, carerId),
        eq(timeEntries.local_date, entryDate)
      )
    );

  await db
    .delete(timesheets)
    .where(
      and(
        eq(timesheets.household_id, householdId),
        eq(timesheets.carer_id, carerId),
        eq(timesheets.week_start, weekStart)
      )
    );

  const [inH, inM] = clockIn.split(':').map(Number);
  const [outH, outM] = clockOut.split(':').map(Number);
  const totalMinutes =
    (outH ?? 0) * 60 + (outM ?? 0) - ((inH ?? 0) * 60 + (inM ?? 0));

  const [timesheet] = await db
    .insert(timesheets)
    .values({
      household_id: householdId,
      carer_id: carerId,
      week_start: weekStart,
      total_minutes: totalMinutes,
      status: 'submitted',
      carer_display_name: carerDisplayName,
    })
    .returning({ id: timesheets.id });

  const [entry] = await db
    .insert(timeEntries)
    .values({
      household_id: householdId,
      carer_id: carerId,
      shift_id: null,
      clock_in_at: zonedWallTimeToUtcIso(entryDate, clockIn, timezone),
      clock_out_at: zonedWallTimeToUtcIso(entryDate, clockOut, timezone),
      break_minutes: 0,
      kind: 'worked',
      status: 'submitted',
      local_date: entryDate, // D1 has no local_date trigger (Postgres' sync_*_local_date): write it.
      timezone,
      carer_display_name: carerDisplayName,
    })
    .returning({ id: timeEntries.id });
  if (!timesheet || !entry) throw new Error('reseed insert returned no row');

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
async function seedDraftHousehold(
  db: Db,
  options: {
    nannyEmail: string;
    nannyName: string;
    rateMinor: number;
    label: string;
  }
): Promise<{ code: string; householdId: string; nannyId: string }> {
  const { nannyEmail, nannyName, rateMinor, label } = options;
  const nannyId = await createConfirmedUser(db, nannyEmail, nannyName);

  const [household] = await db
    .insert(households)
    .values({
      // NULL name is legal only while `state = 'draft'`
      // (`households_live_has_name`, migration 093) — a draft has no family
      // name yet because no family has joined it.
      name: null,
      state: 'draft',
      timezone: TIMEZONE,
      currency: CURRENCY,
      created_by: nannyId,
    })
    .returning({ id: households.id });
  if (!household) throw new Error('draft household insert returned no row');

  await db.insert(householdMembers).values({
    household_id: household.id,
    user_id: nannyId,
    role: 'nanny',
    can_edit: false,
    status: 'active',
  });

  await db.insert(termsProposals).values({
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

  const code = randomInviteCode();
  const now = Date.now();
  await db.insert(householdInvites).values({
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

  console.log(
    `[created] ${label}: draft household ${household.id}, author ${nannyEmail}, code ${code}`
  );
  return { code, householdId: household.id, nannyId };
}

async function main(db: Db): Promise<void> {
  const nannyId = await findUserByEmail(db, NANNY_EMAIL);
  const parentId = await findUserByEmail(db, PARENT_EMAIL);
  if (!nannyId || !parentId) {
    console.error(
      'parent/nanny test accounts missing. Run scripts/seed-test-users.ts first.'
    );
    process.exit(1);
  }

  // Same disambiguation as seed-e2e-approval-fixtures: several households are
  // called "Our household"; the one under test is the one the NANNY is an
  // active member of.
  const candidates = await db
    .select({ id: households.id, timezone: households.timezone })
    .from(households)
    .where(eq(households.name, HOUSEHOLD_NAME));

  let householdId: string | null = null;
  let householdTimezone: string | null = null;
  for (const candidate of candidates) {
    const [membership] = await db
      .select({ user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, candidate.id),
          eq(householdMembers.user_id, nannyId),
          eq(householdMembers.status, 'active')
        )
      )
      .limit(1);
    if (membership) {
      householdId = candidate.id;
      householdTimezone = candidate.timezone;
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
  // Every wall-clock time written into the SHARED household is nominal in this
  // zone, and so are its "today"/"tomorrow" — see TIMEZONE's doc.
  const householdTz = householdTimezone ?? TIMEZONE;
  console.log(`[found]   household -> ${householdId} (${householdTz})`);

  // --- 1. Clear arrangements so flow 07's setup screen is reachable --------
  const clearedArrangements = await db
    .delete(payArrangements)
    .where(
      and(
        eq(payArrangements.household_id, householdId),
        eq(payArrangements.carer_id, nannyId)
      )
    )
    .returning({ id: payArrangements.id });
  console.log(
    `[reset]   deleted ${clearedArrangements.length} pay_arrangements ` +
      '(PaySetupScreen redirects to the hub while one exists)'
  );
  // Flow 07's Save now SENDS A ROUND (a `proposed` terms_proposals row) and
  // the nanny accepts it. A round left open by an aborted run makes
  // PaySetupScreen render the sent-receipt instead of the form, so clear the
  // pair's rounds too.
  const clearedProposals = await db
    .delete(termsProposals)
    .where(
      and(
        eq(termsProposals.household_id, householdId),
        eq(termsProposals.carer_id, nannyId)
      )
    )
    .returning({ id: termsProposals.id });
  console.log(
    `[reset]   deleted ${clearedProposals.length} terms_proposals ` +
      '(PaySetupScreen shows the sent-receipt while one is open)'
  );

  // --- 2. Overtime week ----------------------------------------------------
  await reseedWorkedWeek(db, {
    householdId,
    carerId: nannyId,
    carerDisplayName: 'Test Nanny',
    weekStart: OT_WEEK_START,
    entryDate: OT_ENTRY_DATE,
    clockIn: OT_ENTRY_IN,
    clockOut: OT_ENTRY_OUT,
    timezone: householdTz,
    label: 'overtime week (flow 07)',
  });

  // --- 3. Holiday week -----------------------------------------------------
  await db
    .insert(householdHolidays)
    .values({
      household_id: householdId,
      holiday_key: HOLIDAY_KEY,
      observed: true,
    })
    .onConflictDoUpdate({
      target: [householdHolidays.household_id, householdHolidays.holiday_key],
      set: { observed: true },
    });
  console.log(
    `[ok]      household_holidays observed: ${HOLIDAY_KEY} ` +
      `(resolves to ${HOLIDAY_WEEK_START} in 2026)`
  );

  await reseedWorkedWeek(db, {
    householdId,
    carerId: nannyId,
    carerDisplayName: 'Test Nanny',
    weekStart: HOLIDAY_WEEK_START,
    entryDate: HOLIDAY_WEEK_START,
    clockIn: '09:00',
    clockOut: '17:00',
    timezone: householdTz,
    label: 'holiday week (flow 09)',
  });

  // --- 4. Sunday-workweek household ---------------------------------------
  const [existingSunday] = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.name, SUNDAY_HOUSEHOLD_NAME))
    .limit(1);

  let sundayHouseholdId = existingSunday?.id ?? null;
  if (!sundayHouseholdId) {
    const [created] = await db
      .insert(households)
      .values({
        name: SUNDAY_HOUSEHOLD_NAME,
        timezone: TIMEZONE,
        currency: CURRENCY,
        // 0 = Sunday (migration 075; 0=Sun..6=Sat, default 1=Monday). No UI
        // writes this column — the API resolves every week boundary from it.
        week_starts_on: 0,
        created_by: parentId,
      })
      .returning({ id: households.id });
    if (!created) throw new Error('Sunday household insert returned no row');
    sundayHouseholdId = created.id;
    console.log(`[created] Sunday household -> ${sundayHouseholdId}`);
  } else {
    console.log(`[skip]    Sunday household exists -> ${sundayHouseholdId}`);
  }

  await db
    .insert(householdMembers)
    .values([
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
    ])
    .onConflictDoUpdate({
      target: [householdMembers.user_id, householdMembers.household_id],
      set: {
        role: sql`excluded.role`,
        can_edit: sql`excluded.can_edit`,
        status: sql`excluded.status`,
      },
    });

  // A child is what makes this household ONBOARDED. `useIsOnboarded` treats an
  // owner as set up only once the ACTIVE household has >= 1 child, and the
  // active household is sticky client-side state — so a childless second
  // household does not just look empty, it sends the seed parent into the
  // onboarding wizard on their next sign-in and every flow after that fails on
  // a missing tab bar (seen on flow 07). One child costs nothing and keeps the
  // household a legitimate one to switch into.
  const [sundayChild] = await db
    .select({ id: children.id })
    .from(children)
    .where(eq(children.household_id, sundayHouseholdId))
    .limit(1);
  if (!sundayChild) {
    await db.insert(children).values({
      household_id: sundayHouseholdId,
      name: 'Sunday Kid',
      avatar_initial: 'S',
    });
    console.log('[created] Sunday household child');
  }

  const [sundayArrangement] = await db
    .select({ id: payArrangements.id })
    .from(payArrangements)
    .where(
      and(
        eq(payArrangements.household_id, sundayHouseholdId),
        eq(payArrangements.carer_id, nannyId)
      )
    )
    .limit(1);
  if (!sundayArrangement) {
    await db.insert(payArrangements).values({
      household_id: sundayHouseholdId,
      carer_id: nannyId,
      rate_minor: SUNDAY_RATE_MINOR,
      currency: CURRENCY,
      valid_from: ARRANGEMENT_VALID_FROM,
      carer_display_name: 'Test Nanny',
      created_by: parentId,
    });
    console.log('[created] Sunday household arrangement');
  }

  await reseedWorkedWeek(db, {
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
  const [seedTimesheet] = await db
    .select({ id: timesheets.id })
    .from(timesheets)
    .where(
      and(
        eq(timesheets.household_id, householdId),
        eq(timesheets.carer_id, nannyId),
        eq(timesheets.week_start, SEED_WEEK_START)
      )
    )
    .limit(1);

  if (seedTimesheet) {
    await db
      .delete(payments)
      .where(eq(payments.timesheet_id, seedTimesheet.id));

    // Week-thread messages are `shift_events` rows with `shift_id = null` and
    // `local_date = timesheets.week_start` (`weekThread.ts` — there is no
    // thread table). Clearing them puts flow 11 back at an empty thread.
    await db
      .delete(shiftEvents)
      .where(
        and(
          eq(shiftEvents.household_id, householdId),
          eq(shiftEvents.local_date, SEED_WEEK_START),
          isNull(shiftEvents.shift_id)
        )
      );

    await db
      .update(timesheets)
      .set({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        query_note: null,
        reopen_reason: null,
        earnings: null,
        earnings_computed_at: null,
        gross_minor: null,
      })
      .where(eq(timesheets.id, seedTimesheet.id));

    await db
      .update(timeEntries)
      .set({ status: 'submitted' })
      .where(
        and(
          eq(timeEntries.household_id, householdId),
          eq(timeEntries.carer_id, nannyId),
          gte(timeEntries.local_date, SEED_WEEK_START),
          lt(timeEntries.local_date, addDaysISO(SEED_WEEK_START, 7)),
          ne(timeEntries.status, 'voided')
        )
      );

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
  // its today-shift up with a single-row `maybeSingle()` on `local_date = today`, which
  // throws the moment a second shift shares that date. Seeding these on today
  // would break the other seeder.
  const tomorrow = addDaysISO(localDateOf(new Date(), householdTz), 1);

  await db
    .delete(shifts)
    .where(
      and(
        eq(shifts.household_id, householdId),
        eq(shifts.carer_id, nannyId),
        eq(shifts.local_date, tomorrow),
        eq(shifts.kind, 'cover')
      )
    );

  // Expired ask: `cover_ask_expires_at` in the past while still `pending`, so
  // the nanny sees the M21 deadline before the job runs and the expired state
  // after it. The API computes this column at ask time and never backdates it.
  const [expiredAsk] = await db
    .insert(shifts)
    .values({
      household_id: householdId,
      carer_id: nannyId,
      starts_at: zonedWallTimeToUtcIso(tomorrow, '18:00', householdTz),
      ends_at: zonedWallTimeToUtcIso(tomorrow, '21:00', householdTz),
      timezone: householdTz,
      local_date: tomorrow, // D1 has no local_date trigger (Postgres' sync_*_local_date): write it.
      kind: 'cover',
      status: 'pending',
      origin: 'parent_proposed',
      sequence: 0,
      cover_ask_expires_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      created_by: parentId,
    })
    .returning({ id: shifts.id });

  const [declineAsk] = await db
    .insert(shifts)
    .values({
      household_id: householdId,
      carer_id: nannyId,
      starts_at: zonedWallTimeToUtcIso(tomorrow, '21:30', householdTz),
      ends_at: zonedWallTimeToUtcIso(tomorrow, '22:30', householdTz),
      timezone: householdTz,
      local_date: tomorrow,
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
    .returning({ id: shifts.id });
  if (!expiredAsk || !declineAsk) throw new Error('cover ask insert failed');

  console.log(
    `[created] cover asks on ${tomorrow}: expired ${expiredAsk.id}, decline ${declineAsk.id}`
  );

  // --- 6b. Sick-day fixture reset (flow 08) --------------------------------
  // `SickTimeOffButton` books TODAY, all day, and per D-23 the server opens a
  // `cancel` change request against every overlapping shift. Re-running the
  // flow needs three things back at their start state: no sick row for today,
  // no leftover change request, and the today-shift `confirmed` again.
  const today = localDateOf(new Date(), householdTz);
  const todayEndUtc = zonedWallTimeToUtcIso(
    addDaysISO(today, 1),
    '00:00',
    householdTz
  );
  const todayStartUtc = zonedWallTimeToUtcIso(today, '00:00', householdTz);

  await db
    .delete(carerTimeOff)
    .where(
      and(
        eq(carerTimeOff.user_id, nannyId),
        lt(carerTimeOff.starts_at, todayEndUtc),
        gt(carerTimeOff.ends_at, todayStartUtc)
      )
    );

  // `PHASE4_TODAY_SHIFT_ID` MUST come back non-empty: flow 08 deep-links to
  // `.../shifts/${id}`, and an empty id lands on a screen that never renders
  // `shift-detail-screen`. It silently came back empty during the Phase 5 suite
  // and cost a red flow.
  //
  // ROOT CAUSE, measured not assumed: there were TWO `kind='extra'` shifts on
  // today's date, and `.maybeSingle()` ERRORS on multiple rows. The original
  // call destructured only `{ data }`, so that error was swallowed and the id
  // came out empty with no warning. This file's own comment at the tomorrow-
  // shift fixture already recorded that `.maybeSingle()` "throws the moment a
  // second shift shares that date" — the lesson simply had not been applied
  // here. So: orderBy + limit(1) instead of maybeSingle's uniqueness assumption.
  const todayMatches = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.household_id, householdId),
        eq(shifts.carer_id, nannyId),
        eq(shifts.local_date, today),
        eq(shifts.kind, 'extra')
      )
    )
    .orderBy(desc(shifts.created_at))
    .limit(1);
  let todayShift: { id: string } | null = todayMatches[0] ?? null;

  // Secondary case, also real: nothing on today at all, because
  // `seed-e2e-approval-fixtures.ts` created the shift on whatever calendar day
  // it last ran. Roll the most recent extra shift forward rather than creating
  // a new one — moving it preserves the row's identity and anything already
  // pointing at it.
  if (!todayShift) {
    const [staleShift] = await db
      .select({
        id: shifts.id,
        starts_at: shifts.starts_at,
        ends_at: shifts.ends_at,
        local_date: shifts.local_date,
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.household_id, householdId),
          eq(shifts.carer_id, nannyId),
          eq(shifts.kind, 'extra')
        )
      )
      .orderBy(desc(shifts.local_date))
      .limit(1);

    if (staleShift) {
      // Keep the wall-clock times, move the DATE. Re-deriving the instants from
      // the household zone (rather than adding a day-delta to the stored UTC)
      // is what keeps this correct across a DST boundary.
      const startWall = utcIsoToZonedWallTime(
        staleShift.starts_at,
        householdTz
      );
      const endWall = utcIsoToZonedWallTime(staleShift.ends_at, householdTz);
      await db
        .update(shifts)
        .set({
          local_date: today,
          starts_at: zonedWallTimeToUtcIso(today, startWall, householdTz),
          ends_at: zonedWallTimeToUtcIso(today, endWall, householdTz),
        })
        .where(eq(shifts.id, staleShift.id));
      console.log(
        `[rolled]  extra shift ${staleShift.id} ${staleShift.local_date} -> ${today} (flow 08's today-shift)`
      );
      todayShift = { id: staleShift.id };
    }
  }

  if (todayShift) {
    await db
      .delete(shiftChangeRequests)
      .where(eq(shiftChangeRequests.shift_id, todayShift.id));

    await db
      .update(shifts)
      .set({
        status: 'confirmed',
        cancelled_at: null,
        cancelled_by: null,
        cancellation_paid: false,
        cancellation_message: null,
      })
      .where(eq(shifts.id, todayShift.id));
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
    db,
    freshParentEmail,
    'Phase4 Fresh Parent'
  );

  const draftA = await seedDraftHousehold(db, {
    nannyEmail: `phase4-nanny-a-${suffix}@steadilynanny.test`,
    nannyName: 'Phase4 Nanny A',
    rateMinor: 1800,
    label: 'flow 14 draft',
  });
  const draftB = await seedDraftHousehold(db, {
    nannyEmail: `phase4-nanny-b-${suffix}@steadilynanny.test`,
    nannyName: 'Phase4 Nanny B',
    rateMinor: 1900,
    label: 'flow 15 draft (absorption)',
  });

  // 9. Two more fresh CONFIRMED pairs (a parent + a nanny, NEITHER with a
  //    household), for flows 16/17 — P8's parent-authored pay OFFER and B4's
  //    decline. Deliberately NOT pre-built households/invites like the drafts
  //    above: unlike the nanny-draft leg (still blocked on a missing route,
  //    see the header), the PARENT side of P8 is fully drivable through the
  //    app today (`HouseholdScreen` -> `ChildrenScreen` -> `InviteScreen`'s
  //    offer card), so the flows mint the household and the offer live and
  //    only need bare confirmed accounts here.
  const offerParentEmail = `phase4-offer-parent-${suffix}@steadilynanny.test`;
  const offerParentId = await createConfirmedUser(
    db,
    offerParentEmail,
    'Phase4 Offer Parent'
  );
  const offerNannyEmail = `phase4-offer-nanny-${suffix}@steadilynanny.test`;
  const offerNannyId = await createConfirmedUser(
    db,
    offerNannyEmail,
    'Phase4 Offer Nanny'
  );
  const declineParentEmail = `phase4-decline-parent-${suffix}@steadilynanny.test`;
  const declineParentId = await createConfirmedUser(
    db,
    declineParentEmail,
    'Phase4 Decline Parent'
  );
  const declineNannyEmail = `phase4-decline-nanny-${suffix}@steadilynanny.test`;
  const declineNannyId = await createConfirmedUser(
    db,
    declineNannyEmail,
    'Phase4 Decline Nanny'
  );

  // 10. A QUIET live household for flow 18: fresh parent + fresh nanny, both
  //     active, one child, pay agreed, and NOTHING else — no proposals, no
  //     shifts, no submitted weeks. Flow 18 asserts the "ordinary day" slot
  //     occupants (parent: today's cover, nanny: the clock), which only hold
  //     when the whole attention ladder is empty. The seed parent can never
  //     give it that: `useInboxItems` reads EVERY household she belongs to,
  //     and the shared seed household carries flow 15's pending proposal and
  //     flows 02-09's change requests / submitted weeks. Fresh accounts per
  //     seed, so no earlier pass can pollute it.
  const quietParentEmail = `phase4-quiet-parent-${suffix}@steadilynanny.test`;
  const quietParentId = await createConfirmedUser(
    db,
    quietParentEmail,
    'Phase4 Quiet Parent'
  );
  const quietNannyEmail = `phase4-quiet-nanny-${suffix}@steadilynanny.test`;
  const quietNannyId = await createConfirmedUser(
    db,
    quietNannyEmail,
    'Phase4 Quiet Nanny'
  );
  const [quietHousehold] = await db
    .insert(households)
    .values({
      name: 'Quiet household',
      timezone: TIMEZONE,
      currency: CURRENCY,
      created_by: quietParentId,
    })
    .returning({ id: households.id });
  if (!quietHousehold)
    throw new Error('quiet household insert returned no row');
  await db.insert(householdMembers).values([
    {
      household_id: quietHousehold.id,
      user_id: quietParentId,
      role: 'owner',
      can_edit: true,
      status: 'active',
    },
    {
      household_id: quietHousehold.id,
      user_id: quietNannyId,
      role: 'nanny',
      can_edit: false,
      status: 'active',
    },
  ]);
  // A child makes the owner ONBOARDED (see the Sunday household above).
  await db.insert(children).values({
    household_id: quietHousehold.id,
    name: 'Quiet Kid',
    avatar_initial: 'Q',
  });
  // Agreed terms, so the nanny's slot is the clock, not A1's terms block.
  await db.insert(payArrangements).values({
    household_id: quietHousehold.id,
    carer_id: quietNannyId,
    rate_minor: SUNDAY_RATE_MINOR,
    currency: CURRENCY,
    valid_from: ARRANGEMENT_VALID_FROM,
    carer_display_name: 'Phase4 Quiet Nanny',
    created_by: quietParentId,
  });
  console.log(`[created] quiet household ${quietHousehold.id} (flow 18)`);

  // --- Driver contract -----------------------------------------------------
  // ONE guard at the contract boundary, instead of an error check at each of the
  // ~18 `maybeSingle()` lookups that feed it.
  //
  // Every value below is interpolated into a Maestro `-e KEY=VALUE` flag, and
  // several are then interpolated into deep links. An EMPTY one does not fail —
  // it produces a valid-looking URL like `.../shifts/` that lands somewhere
  // unexpected, and the flow dies several steps later on an unrelated-looking
  // assertion. That is exactly how flow 08 went red in the Phase 5 suite:
  // `.maybeSingle()` errored on duplicate rows, the `{ data }`-only destructure
  // swallowed it, and the id silently became ''.
  //
  // Failing loudly HERE turns that whole class into one obvious error message,
  // and covers future lookups without anyone remembering to check them.
  const contract: Array<[string, string]> = [
    ['PHASE4_HOUSEHOLD_ID', String(householdId)],
    ['PHASE4_NANNY_ID', String(nannyId)],
    ['PHASE4_PARENT_ID', String(parentId)],
    ['PHASE4_SEED_WEEK_START', String(SEED_WEEK_START)],
    ['PHASE4_OT_WEEK_START', String(OT_WEEK_START)],
    ['PHASE4_HOLIDAY_WEEK_START', String(HOLIDAY_WEEK_START)],
    ['PHASE4_SUNDAY_HOUSEHOLD_ID', String(sundayHouseholdId)],
    ['PHASE4_SUNDAY_WEEK_START', String(SUNDAY_WEEK_START)],
    ['PHASE4_ARRANGEMENT_VALID_FROM', String(ARRANGEMENT_VALID_FROM)],
    ['PHASE4_HOURLY_RATE', String(HOURLY_RATE_MAJOR)],
    ['PHASE4_HOLIDAY_MULTIPLIER', String(WORKED_HOLIDAY_MULTIPLIER)],
    ['PHASE4_TODAY_SHIFT_ID', String(todayShift?.id ?? '')],
    ['PHASE4_EXPIRED_ASK_SHIFT_ID', String(expiredAsk.id)],
    ['PHASE4_DECLINE_ASK_SHIFT_ID', String(declineAsk.id)],
    ['PHASE4_NEW_PARENT_EMAIL', String(freshParentEmail)],
    ['PHASE4_NEW_PARENT_ID', String(freshParentId)],
    ['PHASE4_DRAFT_CODE_A', String(draftA.code)],
    ['PHASE4_DRAFT_HOUSEHOLD_A', String(draftA.householdId)],
    ['PHASE4_DRAFT_CODE_B', String(draftB.code)],
    ['PHASE4_DRAFT_HOUSEHOLD_B', String(draftB.householdId)],
    ['PHASE4_OFFER_PARENT_EMAIL', String(offerParentEmail)],
    ['PHASE4_OFFER_PARENT_ID', String(offerParentId)],
    ['PHASE4_OFFER_NANNY_EMAIL', String(offerNannyEmail)],
    ['PHASE4_OFFER_NANNY_ID', String(offerNannyId)],
    ['PHASE4_DECLINE_PARENT_EMAIL', String(declineParentEmail)],
    ['PHASE4_DECLINE_PARENT_ID', String(declineParentId)],
    ['PHASE4_DECLINE_NANNY_EMAIL', String(declineNannyEmail)],
    ['PHASE4_DECLINE_NANNY_ID', String(declineNannyId)],
    ['PHASE4_QUIET_HOUSEHOLD_ID', String(quietHousehold.id)],
    ['PHASE4_QUIET_PARENT_EMAIL', String(quietParentEmail)],
    ['PHASE4_QUIET_NANNY_EMAIL', String(quietNannyEmail)],
  ];
  const emptyKeys = contract.filter(
    ([, v]) => v === '' || v === 'undefined' || v === 'null'
  );
  if (emptyKeys.length > 0) {
    throw new Error(
      `seeder produced empty contract values: ${emptyKeys.map(([k]) => k).join(', ')}. ` +
        'A lookup failed silently — check for duplicate rows breaking a `.maybeSingle()`, ' +
        'whose error is discarded by a `{ data }`-only destructure.'
    );
  }

  console.log('\n# --- eval me (run-phase4.sh) ---');
  for (const [key, value] of contract) {
    console.log(`${key}=${value}`);
  }
}

const { db, dispose } = await getLocalDb();
try {
  await main(db);
} finally {
  await dispose();
}
