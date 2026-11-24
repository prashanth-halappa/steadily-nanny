#!/usr/bin/env bun
/**
 * Reset nanny@'s CURRENT week in "Our household" so flow
 * `tests/37-clockout-into-paid-week.yaml` can run again.
 *
 * Flow 37 drives the real current week: two clock sessions, the parent
 * approves and pays it, then a second clock-out lands in the paid week. After
 * a pass the week is approved, paid and flagged, so a re-run finds the approve
 * button disabled. This deletes the nanny's time entries, timesheets and their
 * payments in that household for any week starting in the last 7 days (the
 * current week whatever `week_starts_on` is). The seed weeks (2026-01) are
 * never touched.
 *
 * Usage: bun run scripts/seed-paid-week-reset.ts
 *
 * @module scripts/seed-paid-week-reset
 */

import { and, eq, gte, inArray } from 'drizzle-orm';
import {
  householdMembers,
  households,
  payments,
  timeEntries,
  timesheets,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';

const { db, dispose } = await getLocalDb();
try {
  const [nanny] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, NANNY_EMAIL));
  if (!nanny) throw new Error('Cast missing. Run seed-test-users.ts first.');

  // Same disambiguation as seed-carer1-terms.ts: the "Our household" she is
  // an active member of.
  const [hh] = await db
    .select({ id: households.id })
    .from(households)
    .innerJoin(
      householdMembers,
      eq(householdMembers.household_id, households.id)
    )
    .where(
      and(
        eq(households.name, HOUSEHOLD_NAME),
        eq(householdMembers.user_id, nanny.id),
        eq(householdMembers.status, 'active')
      )
    )
    .limit(1);
  if (!hh) throw new Error(`No "${HOUSEHOLD_NAME}" with ${NANNY_EMAIL}.`);

  const since = new Date(Date.now() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const mine = and(
    eq(timesheets.household_id, hh.id),
    eq(timesheets.carer_id, nanny.id),
    gte(timesheets.week_start, since)
  );
  const sheetIds = (
    await db.select({ id: timesheets.id }).from(timesheets).where(mine)
  ).map(r => r.id);
  if (sheetIds.length) {
    await db.delete(payments).where(inArray(payments.timesheet_id, sheetIds));
    await db.delete(timesheets).where(inArray(timesheets.id, sheetIds));
  }
  // Entries from 7 days back cover the whole current week; a week's entries
  // are always on or after its week_start.
  const entries = await db
    .delete(timeEntries)
    .where(
      and(
        eq(timeEntries.household_id, hh.id),
        eq(timeEntries.carer_id, nanny.id),
        gte(timeEntries.local_date, since)
      )
    )
    .returning({ id: timeEntries.id });
  // A running entry in ANY of her households pins Today's clock card to its
  // clock-out state (`useRunningTimeEntry` is cross-household), so there is
  // no `today-clock-in` to tap. Flow 22's seeder leaves one running in the
  // Cole household on purpose; clear it the way that seeder clears ours.
  const running = await db
    .delete(timeEntries)
    .where(
      and(eq(timeEntries.carer_id, nanny.id), eq(timeEntries.status, 'running'))
    )
    .returning({ id: timeEntries.id });
  console.log(
    `[reset] household ${hh.id}: ${sheetIds.length} timesheet(s) + payments, ${entries.length} time entr(ies) since ${since}; ${running.length} running entr(ies) cleared in any household`
  );
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await dispose();
}
