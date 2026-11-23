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
 * `--two-block` (flow 25): after the reset, also seed a `pending` pattern
 * from the parent, starting next Monday, with MONDAY split into two blocks
 * (07:00-13:00 + 15:00-18:00) and Tue-Fri 08:00-13:00, and print
 * USUAL_WEEK_TWO_BLOCK_PATTERN_ID. Run the plain seeder afterwards to reset,
 * because a pending week shows up in the nanny's (global) Today inbox.
 *
 * Usage: bun run scripts/seed-usual-week-fixtures.ts [--two-block]
 * Prereqs: scripts/seed-test-users.ts (PARENT_EMAIL / NANNY_EMAIL exist).
 *
 * @module scripts/seed-usual-week-fixtures
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  childCommitments,
  children,
  householdMembers,
  households,
  payArrangements,
  schedulePatternDays,
  schedulePatterns,
  shifts,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const PARENT_EMAIL = 'parent@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';

const HOUSEHOLD_NAME = 'Usual Week household';
const CHILD_NAME = 'Usual Week Kid';
const RATE_MINOR = 1800; // $18.00/hr
const CURRENCY = 'USD';
const ARRANGEMENT_VALID_FROM = '2026-01-01';
const TIMEZONE = 'America/Los_Angeles';

async function findUserByEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

async function main(db: Db): Promise<void> {
  const parentId = await findUserByEmail(db, PARENT_EMAIL);
  const nannyId = await findUserByEmail(db, NANNY_EMAIL);
  if (!parentId || !nannyId) {
    console.error(
      `${PARENT_EMAIL} / ${NANNY_EMAIL} not found. Run scripts/seed-test-users.ts first.`
    );
    process.exit(1);
  }

  // --- household -----------------------------------------------------------
  const [existing] = await db
    .select({ id: households.id })
    .from(households)
    .where(
      and(
        eq(households.name, HOUSEHOLD_NAME),
        eq(households.created_by, parentId)
      )
    )
    .limit(1);

  let householdId = existing?.id ?? null;
  if (!householdId) {
    const [row] = await db
      .insert(households)
      .values({
        name: HOUSEHOLD_NAME,
        timezone: TIMEZONE,
        created_by: parentId,
      })
      .returning({ id: households.id });
    if (!row) throw new Error('household insert returned no row');
    householdId = row.id;
    console.log(`[created] household ${HOUSEHOLD_NAME} -> ${householdId}`);
  } else {
    console.log(`[skip]    household already exists -> ${householdId}`);
  }

  // `joined_at` backdated well past `JOINED_CARD_MAX_AGE_MS` (7 days, both
  // `WeeklyHoursNotSetCard` and `NoWeekYetCard`) — a fresh `joined_at` makes
  // the nanny-joined welcome moment show INSTEAD of the card under test on
  // both sides (`momentShowing` / `joinedCardShowing`), which is correct app
  // behaviour but not what this fixture is for.
  const JOINED_AT = new Date('2026-06-01T00:00:00Z').toISOString();
  await db
    .insert(householdMembers)
    .values([
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
    ])
    .onConflictDoUpdate({
      target: [householdMembers.user_id, householdMembers.household_id],
      set: {
        role: sql`excluded.role`,
        can_edit: sql`excluded.can_edit`,
        status: sql`excluded.status`,
        joined_at: sql`excluded.joined_at`,
      },
    });

  // --- child + care hours ----------------------------------------------------
  const [existingChild] = await db
    .select({ id: children.id })
    .from(children)
    .where(
      and(eq(children.household_id, householdId), eq(children.name, CHILD_NAME))
    )
    .limit(1);

  let childId = existingChild?.id ?? null;
  if (!childId) {
    const [row] = await db
      .insert(children)
      .values({
        household_id: householdId,
        name: CHILD_NAME,
        avatar_initial: 'U',
      })
      .returning({ id: children.id });
    if (!row) throw new Error('child insert returned no row');
    childId = row.id;
    console.log('[created] child');
  } else {
    console.log('[skip]    child already exists');
  }

  const [existingCommitment] = await db
    .select({ id: childCommitments.id })
    .from(childCommitments)
    .where(
      and(
        eq(childCommitments.child_id, childId),
        eq(childCommitments.label, 'Care hours')
      )
    )
    .limit(1);
  if (!existingCommitment) {
    await db.insert(childCommitments).values({
      child_id: childId,
      household_id: householdId,
      kind: 'other',
      label: 'Care hours',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      start_time: '07:00',
      end_time: '13:00',
    });
    console.log('[created] weekday 07:00-13:00 care-hours commitment');
  } else {
    console.log('[skip]    care-hours commitment already exists');
  }

  // --- terms agreed (direct write — see module doc) --------------------------
  const [existingArrangement] = await db
    .select({ id: payArrangements.id })
    .from(payArrangements)
    .where(
      and(
        eq(payArrangements.household_id, householdId),
        eq(payArrangements.carer_id, nannyId)
      )
    )
    .limit(1);
  if (!existingArrangement) {
    await db.insert(payArrangements).values({
      household_id: householdId,
      carer_id: nannyId,
      rate_minor: RATE_MINOR,
      currency: CURRENCY,
      valid_from: ARRANGEMENT_VALID_FROM,
      carer_display_name: 'Test Nanny',
      created_by: parentId,
    });
    console.log('[created] pay arrangement (terms agreed)');
  } else {
    console.log('[skip]    pay arrangement already exists');
  }

  // --- reset: no schedule pattern, no shifts ---------------------------------
  // Re-runnable: undoes whatever a PRIOR Maestro pass sent, so the household
  // is back at "terms agreed, nothing scheduled" every time this script runs.
  const deletedPatterns = await db
    .delete(schedulePatterns)
    .where(eq(schedulePatterns.household_id, householdId))
    .returning({ id: schedulePatterns.id });
  if (deletedPatterns.length > 0) {
    console.log(
      `[reset]   deleted ${deletedPatterns.length} schedule_pattern(s)`
    );
  }

  const deletedShifts = await db
    .delete(shifts)
    .where(eq(shifts.household_id, householdId))
    .returning({ id: shifts.id });
  if (deletedShifts.length > 0) {
    console.log(`[reset]   deleted ${deletedShifts.length} shift(s)`);
  }

  let twoBlockPatternId: string | null = null;
  if (process.argv.includes('--two-block')) {
    // Next Monday in the household's zone (weekday 1 = Monday, 0 = Sunday).
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
    }).format(new Date());
    const dt = new Date(`${today}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + ((8 - dt.getUTCDay()) % 7 || 7));
    const [pattern] = await db
      .insert(schedulePatterns)
      .values({
        household_id: householdId,
        carer_id: nannyId,
        status: 'pending',
        rrule: 'FREQ=WEEKLY;INTERVAL=1',
        dtstart: dt.toISOString().slice(0, 10),
        timezone: TIMEZONE,
        created_by: parentId,
        sent_at: new Date().toISOString(),
      })
      .returning({ id: schedulePatterns.id });
    if (!pattern) throw new Error('pattern insert returned no row');
    await db.insert(schedulePatternDays).values(
      [
        { weekday: 1, start_time: '07:00', end_time: '13:00' },
        { weekday: 1, start_time: '15:00', end_time: '18:00' },
        ...[2, 3, 4, 5].map(weekday => ({
          weekday,
          start_time: '08:00',
          end_time: '13:00',
        })),
      ].map(day => ({ ...day, pattern_id: pattern.id }))
    );
    twoBlockPatternId = pattern.id;
    console.log('[created] pending two-block-Monday pattern (flow 25)');
  }

  console.log('\n# --- eval me ---------------------------------------------');
  console.log(`USUAL_WEEK_HOUSEHOLD_ID=${householdId}`);
  console.log(`USUAL_WEEK_NANNY_ID=${nannyId}`);
  console.log(`USUAL_WEEK_PARENT_ID=${parentId}`);
  if (twoBlockPatternId) {
    console.log(`USUAL_WEEK_TWO_BLOCK_PATTERN_ID=${twoBlockPatternId}`);
  }
}

const { db, dispose } = await getLocalDb();
try {
  await main(db);
} finally {
  await dispose();
}
