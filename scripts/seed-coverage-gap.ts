#!/usr/bin/env bun
/**
 * Fixture for tests/38-parent-cover-not-payable.yaml and
 * tests/39-closure-over-booked-day.yaml: a household where TODAY is
 * guaranteed to have exactly ONE uncovered care window, so the parent's Today
 * shows `today-coverage-gap-card` with its "I've got it" action.
 *
 * WHY NOT "Our household": seed-e2e-approval-fixtures.ts books nanny@ a
 * confirmed 08:00–17:00 shift TODAY (PHASE4_TODAY_SHIFT_ID, flow 08 needs
 * it), which covers the bootstrap's weekday 09:00–17:00 care hours, so that
 * household never has a gap today. Each flow also mutates coverage (a
 * parent_cover shift, a closure, extra commitments), and the gap card's
 * "I've got it" button only renders for a SINGLE window, so re-runs on a
 * shared household break each other. A fresh household per run pollutes
 * nothing and is re-runnable.
 *
 * Seeds: parent (owner) + nanny (active), one child, an agreed pay
 * arrangement plus a submitted week holding one 1h time entry ending a minute ago (so the
 * parent's Hours screen shows a non-zero payable `hours-earnings-line` — a
 * zero-hours week renders none — for flow 38 to baseline) and ONE care
 * commitment covering every day 00:00–23:59 (so the gap exists whatever the
 * weekday or time of day the flow runs). Nothing is booked. Prints, for `-e`:
 *   COVER_GAP_PARENT_EMAIL, COVER_GAP_HOUSEHOLD_ID   (password: SteadilyTest!2026)
 *
 * `--no-commitment` (tests/40-care-hours-wider-uncovered-row.yaml) skips the
 * care commitment, so the household has NO care hours and the flow's own
 * commitment-form add is the only thing that can create an uncovered row.
 *
 * Usage: D1_REMOTE=1 CLOUDFLARE_ACCOUNT_ID=… bun run scripts/seed-coverage-gap.ts [--no-commitment]
 *
 * @module scripts/seed-coverage-gap
 */

import type { Db } from '../apps/api/src/db/client';
import {
  childCommitments,
  children,
  householdMembers,
  households,
  payArrangements,
  timeEntries,
  timesheets,
  userProfiles,
} from '../apps/api/src/db/schema';
import { ensureUser, getLocalDb } from './lib/localDb';

const TEST_PASSWORD = 'SteadilyTest!2026';
const TIMEZONE = 'Europe/London';
const CURRENCY = 'GBP';

async function createUser(
  db: Db,
  email: string,
  name: string
): Promise<string> {
  const { id } = await ensureUser(db, { email, password: TEST_PASSWORD, name });
  await db
    .insert(userProfiles)
    .values({ user_id: id, name, timezone: TIMEZONE })
    .onConflictDoUpdate({
      target: userProfiles.user_id,
      set: { name, timezone: TIMEZONE },
    });
  return id;
}

async function main(db: Db): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const parentEmail = `cover-parent-${suffix}@steadilynanny.test`;
  const parentId = await createUser(db, parentEmail, 'Cover Parent');
  const nannyId = await createUser(
    db,
    `cover-nanny-${suffix}@steadilynanny.test`,
    'Cover Nanny'
  );

  const [household] = await db
    .insert(households)
    .values({
      name: 'Cover household',
      timezone: TIMEZONE,
      currency: CURRENCY,
      created_by: parentId,
    })
    .returning({ id: households.id });
  if (!household) throw new Error('household insert returned no row');

  await db.insert(householdMembers).values([
    {
      household_id: household.id,
      user_id: parentId,
      role: 'owner',
      can_edit: true,
      status: 'active',
    },
    {
      household_id: household.id,
      user_id: nannyId,
      role: 'nanny',
      can_edit: false,
      status: 'active',
    },
  ]);
  const [child] = await db
    .insert(children)
    .values({
      household_id: household.id,
      name: 'Cover Kid',
      avatar_initial: 'C',
    })
    .returning({ id: children.id });
  if (!child) throw new Error('child insert returned no row');
  await db.insert(payArrangements).values({
    household_id: household.id,
    carer_id: nannyId,
    rate_minor: 1500,
    currency: CURRENCY,
    valid_from: '2026-01-01',
    carer_display_name: 'Cover Nanny',
    created_by: parentId,
  });
  // Not a shift: a time entry pays without covering any need window.
  // ponytail: a seed in the first hour of a Monday lands this in last week.
  const clockOut = new Date(Date.now() - 60_000);
  const clockIn = new Date(clockOut.getTime() - 3_600_000);
  // en-CA formats as YYYY-MM-DD. D1 has no local_date trigger: write it.
  const localDate = clockIn.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  // The week's timesheet row is what the clock-out path creates alongside
  // the entry; without it the Hours money card reads "no hours logged".
  const monday = new Date(`${localDate}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  await db.insert(timesheets).values({
    household_id: household.id,
    carer_id: nannyId,
    week_start: monday.toISOString().slice(0, 10),
    total_minutes: 60,
    status: 'submitted',
    carer_display_name: 'Cover Nanny',
  });
  await db.insert(timeEntries).values({
    household_id: household.id,
    carer_id: nannyId,
    clock_in_at: clockIn.toISOString(),
    clock_out_at: clockOut.toISOString(),
    break_minutes: 0,
    kind: 'worked',
    status: 'submitted',
    local_date: localDate,
    timezone: TIMEZONE,
    carer_display_name: 'Cover Nanny',
  });
  // ponytail: 23:59 not 24:00 — a run in the day's last minute sees no gap.
  if (!process.argv.includes('--no-commitment')) {
    await db.insert(childCommitments).values({
      child_id: child.id,
      household_id: household.id,
      kind: 'other',
      label: 'All day',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
      start_time: '00:00',
      end_time: '23:59',
    });
  }

  console.log('\n# --- eval me (seed-coverage-gap) ---');
  console.log(`COVER_GAP_PARENT_EMAIL=${parentEmail}`);
  console.log(`COVER_GAP_HOUSEHOLD_ID=${household.id}`);
}

const { db, dispose } = await getLocalDb();
try {
  await main(db);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await dispose();
}
