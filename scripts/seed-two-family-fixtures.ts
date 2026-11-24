#!/usr/bin/env bun
/**
 * Fixtures for Maestro flow 22 (`22-audit-two-family-nanny.yaml`): the nanny
 * works for two families and nothing from family B (LEAKCANARY) may bleed
 * into family A's screens, or vice versa.
 *
 * Seeds, all in the LEAKCANARY household (B) for nanny@steadilynanny.test:
 *   - a RUNNING time_entry (clocked in an hour ago, no clock-out) — A1;
 *   - a `pending` schedule_pattern, Mon/Wed 08:00-13:00 — A2/A5;
 *   - a `proposed` terms_proposal, direction='parent' (family B offering) — A2/A3.
 *
 * NOT part of seed-launch-pass.sh on purpose: a running entry, a pending week
 * and an open offer change the nanny's Today and Inbox for every other flow
 * that signs her in. Run it right before flow 22 and `--clean` right after.
 *
 * Every run deletes the previous fixture rows first, so it is re-runnable and
 * always prints fresh ids. Requires scripts/seed-second-household.ts first.
 *
 * Usage:
 *   bun run scripts/seed-two-family-fixtures.ts          # seed, print ids
 *   bun run scripts/seed-two-family-fixtures.ts --clean  # remove fixtures
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  households,
  schedulePatternDays,
  schedulePatterns,
  termsProposals,
  timeEntries,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const OTHER_PARENT_EMAIL = 'otherparent@steadilynanny.test';
const HOUSEHOLD_NAME = 'LEAKCANARY the Cole household';
const TZ = 'Europe/London';
const NANNY_DISPLAY_NAME = 'Nia';
/** Marks the fixture rows so --clean never touches anything else. */
const NOTE = 'seed-two-family-fixtures';

async function idOf(db: Db, email: string): Promise<string> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!row) throw new Error(`${email} missing — run seed-test-users.ts`);
  return row.id;
}

/** YYYY-MM-DD of `d` in `tz`. */
function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

async function clean(
  db: Db,
  householdId: string,
  nannyId: string
): Promise<void> {
  await db
    .delete(schedulePatterns)
    .where(
      and(
        eq(schedulePatterns.household_id, householdId),
        eq(schedulePatterns.note, NOTE)
      )
    );
  await db
    .delete(termsProposals)
    .where(
      and(
        eq(termsProposals.household_id, householdId),
        eq(termsProposals.carer_id, nannyId)
      )
    );
  await db
    .delete(timeEntries)
    .where(
      and(
        eq(timeEntries.household_id, householdId),
        eq(timeEntries.carer_id, nannyId),
        eq(timeEntries.note, NOTE)
      )
    );
}

async function main(db: Db): Promise<void> {
  const nannyId = await idOf(db, NANNY_EMAIL);
  const parentId = await idOf(db, OTHER_PARENT_EMAIL);
  const [household] = await db
    .select({ id: households.id, currency: households.currency })
    .from(households)
    .where(eq(households.name, HOUSEHOLD_NAME))
    .limit(1);
  if (!household) {
    throw new Error(`${HOUSEHOLD_NAME} missing — run seed-second-household.ts`);
  }

  await clean(db, household.id, nannyId);
  if (process.argv.includes('--clean')) {
    console.log('[clean]   flow 22 fixtures removed');
    return;
  }

  // One running entry per carer is a unique index: a leftover running entry
  // from another flow would make the insert fail, and A1 needs her clocked in HERE.
  await db
    .delete(timeEntries)
    .where(
      and(eq(timeEntries.carer_id, nannyId), eq(timeEntries.status, 'running'))
    );

  const now = new Date();
  const [entry] = await db
    .insert(timeEntries)
    .values({
      household_id: household.id,
      carer_id: nannyId,
      clock_in_at: new Date(now.getTime() - 3_600_000).toISOString(),
      kind: 'worked',
      status: 'running',
      note: NOTE,
      local_date: localDate(now, TZ), // D1 has no local_date trigger: write it.
      timezone: TZ,
      carer_display_name: NANNY_DISPLAY_NAME,
    })
    .returning({ id: timeEntries.id });

  // Next Monday (weekday 1 = Monday, 0 = Sunday).
  const dt = new Date(`${localDate(now, TZ)}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + ((8 - dt.getUTCDay()) % 7 || 7));
  const [pattern] = await db
    .insert(schedulePatterns)
    .values({
      household_id: household.id,
      carer_id: nannyId,
      status: 'pending',
      rrule: 'FREQ=WEEKLY;INTERVAL=1',
      dtstart: dt.toISOString().slice(0, 10),
      timezone: TZ,
      note: NOTE,
      created_by: parentId,
      sent_at: now.toISOString(),
    })
    .returning({ id: schedulePatterns.id });
  if (!pattern) throw new Error('pattern insert returned no row');
  await db.insert(schedulePatternDays).values(
    [1, 3].map(weekday => ({
      pattern_id: pattern.id,
      weekday,
      start_time: '08:00',
      end_time: '13:00',
    }))
  );

  const [proposal] = await db
    .insert(termsProposals)
    .values({
      household_id: household.id,
      carer_id: nannyId,
      proposed_by: parentId,
      direction: 'parent',
      status: 'proposed',
      // No `note`: ProposalReviewScreen renders it. Cleaned by household+carer.
      terms: {
        rate_minor: 2100,
        currency: household.currency,
        valid_from: localDate(now, TZ),
        overtime_multiplier: 1.5,
        overtime_threshold_minutes: 2400,
      },
      carer_display_name: NANNY_DISPLAY_NAME,
    })
    .returning({ id: termsProposals.id });
  if (!entry || !proposal) throw new Error('insert returned no row');

  console.log('\n# --- eval me ---------------------------------------------');
  console.log(`TWO_FAMILY_TIME_ENTRY_ID=${entry.id}`);
  console.log(`TWO_FAMILY_PATTERN_ID=${pattern.id}`);
  console.log(`TWO_FAMILY_PROPOSAL_ID=${proposal.id}`);
}

const { db, dispose } = await getLocalDb();
try {
  await main(db);
} finally {
  await dispose();
}
