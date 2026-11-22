#!/usr/bin/env bun
/**
 * Give the household's SECOND nanny their own pay arrangement, at a
 * deliberately different rate from the first — AND give the FIRST nanny an
 * `accepted` schedule_pattern, so flow 33 has an already-settled usual week
 * to prove nanny 2's own handoff never touches.
 *
 * WHY SEEDED RATHER THAN DRIVEN
 * `PaySetupScreen` is drivable — flow 07 does it — but only at the cost of
 * roughly a hundred lines of keyboard-occlusion workarounds (that screen's
 * `hideKeyboard` is a no-op, and `scrollUntilVisible` no-ops too because
 * Maestro's visibility test is hierarchy-based, not occlusion-based). Flow 07
 * already proves the form works. What S3 needs proved is something else
 * entirely: that two carers' terms stay SEPARATE, and that one nanny can never
 * read the other's rate. Seeding the second arrangement puts the flow's
 * assertions on that claim instead of on a form that is already covered.
 *
 * Same reasoning for nanny 1's pattern: flow 21 already drives build -> send
 * -> accept end to end, through the real wizard. Flow 33 needs proved is
 * COEXISTENCE — that accepting a second carer's week never supersedes,
 * ends, or edits a different carer's already-accepted one — not the handoff
 * a second time. Written directly into `schedule_patterns` /
 * `schedule_pattern_days`, bypassing `schedulePatternCommandService`, the
 * same way this script's pay arrangement bypasses `PaySetupScreen`: no
 * `shifts` rows are materialised, because every screen this flow reads
 * (`SchedulePendingScreen`, `SchedulePatternBanner`, `NannyUsualWeekScreen`)
 * renders straight off `schedule_patterns`/`schedule_pattern_days`, never off
 * materialised shifts — see their own module headers.
 *
 * The rate is deliberately distinctive. £22.50 shares no digits with the
 * seeded £15.00, so a screenshot showing the wrong carer's rate is obvious
 * rather than plausible. Same idea for the two patterns' hours: nanny 1 is
 * Mon/Wed/Fri 08:00-14:00, nanny 2 (built live, in-flow) ends up on
 * Tue/Thu 09:00-17:00 — no shared start time, so a leaked or clobbered row
 * is obvious in a screenshot rather than plausible.
 *
 * PRECONDITION: nanny2@steadilynanny.test must already be an active member of
 * "Our household" — that is what flow 31 creates, through the app. This script
 * refuses rather than inventing the membership, because a membership conjured
 * here would make flow 31 untested and still look green.
 *
 * Idempotent. Run AFTER tests/31-second-nanny-joins.yaml.
 *
 * Usage: bun run scripts/seed-s3-second-carer.ts
 *
 * @module scripts/seed-s3-second-carer
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  householdMembers,
  households,
  payArrangements,
  schedulePatternDays,
  schedulePatterns,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const NANNY2_EMAIL = 'nanny2@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';

/** Shares no digits with the first carer's 1500, so a leak is unmistakable. */
const NANNY2_RATE_MINOR = 2250;
const NANNY2_DISPLAY_NAME = 'Sam Okafor';
const VALID_FROM = '2026-01-01';

// --- nanny 1's accepted usual week (flow 33's coexistence fixture) --------
/** A Monday, so the RRULE's own dtstart lines up with its first BYDAY. */
const NANNY1_PATTERN_DTSTART = '2026-01-05';
const NANNY1_PATTERN_RRULE = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR';
const NANNY1_PATTERN_DAYS = [1, 3, 5] as const; // Mon, Wed, Fri
const NANNY1_PATTERN_START = '08:00';
const NANNY1_PATTERN_END = '14:00';

async function findUserByEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

async function main(db: Db): Promise<void> {
  const nanny2Id = await findUserByEmail(db, NANNY2_EMAIL);
  const nannyId = await findUserByEmail(db, NANNY_EMAIL);
  const parentId = await findUserByEmail(db, PARENT_EMAIL);
  if (!nanny2Id || !nannyId || !parentId) {
    console.error('Cast missing. Run scripts/seed-test-users.ts first.');
    process.exit(1);
  }

  // Same disambiguation the fixture seeders use: name AND an active nanny
  // membership, so a stray same-named household is never adopted.
  const candidates = await db
    .select({
      id: households.id,
      currency: households.currency,
      timezone: households.timezone,
    })
    .from(households)
    .where(eq(households.name, HOUSEHOLD_NAME));

  const activeMember = async (hid: string, uid: string) => {
    const [m] = await db
      .select({ user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, hid),
          eq(householdMembers.user_id, uid),
          eq(householdMembers.status, 'active')
        )
      )
      .limit(1);
    return m;
  };

  let householdId: string | null = null;
  let currency = 'GBP';
  let timezone = 'UTC';
  for (const candidate of candidates) {
    if (await activeMember(candidate.id, nannyId)) {
      householdId = candidate.id;
      currency = candidate.currency ?? 'GBP';
      timezone = candidate.timezone ?? 'UTC';
      break;
    }
  }
  if (!householdId) {
    console.error(`No "${HOUSEHOLD_NAME}" with ${NANNY_EMAIL} as a member.`);
    process.exit(1);
  }

  // The membership is flow 31's output. Refuse rather than create it: a
  // membership conjured here would leave flow 31 untested and still green.
  if (!(await activeMember(householdId, nanny2Id))) {
    console.error(
      `${NANNY2_EMAIL} is not an active member of "${HOUSEHOLD_NAME}". ` +
        'Run tests/31-second-nanny-joins.yaml first — this script will not ' +
        'create the membership, because that is what flow 31 proves.'
    );
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: payArrangements.id, rate_minor: payArrangements.rate_minor })
    .from(payArrangements)
    .where(
      and(
        eq(payArrangements.household_id, householdId),
        eq(payArrangements.carer_id, nanny2Id)
      )
    )
    .orderBy(desc(payArrangements.valid_from))
    .limit(1);

  if (existing) {
    console.log(
      `[skip]    nanny2 arrangement exists -> ${existing.id} (${existing.rate_minor} minor)`
    );
  } else {
    const [created] = await db
      .insert(payArrangements)
      .values({
        household_id: householdId,
        carer_id: nanny2Id,
        rate_minor: NANNY2_RATE_MINOR,
        currency,
        valid_from: VALID_FROM,
        carer_display_name: NANNY2_DISPLAY_NAME,
        created_by: parentId,
      })
      .returning({ id: payArrangements.id });
    console.log(
      `[created] nanny2 arrangement -> ${created?.id} (${NANNY2_RATE_MINOR} minor ${currency})`
    );
  }

  // --- nanny 1's accepted usual week (flow 33's coexistence fixture) ------
  // Migration 104's `schedule_patterns_one_accepted_idx` allows exactly one
  // ACCEPTED row per (household, carer) — check first, so a second run of
  // this script (or a prior flow 21/25/33 pass against this SAME household)
  // never collides with it or leaves a duplicate for `resolveActivePattern`
  // to disambiguate.
  const [existingPattern] = await db
    .select({ id: schedulePatterns.id })
    .from(schedulePatterns)
    .where(
      and(
        eq(schedulePatterns.household_id, householdId),
        eq(schedulePatterns.carer_id, nannyId),
        eq(schedulePatterns.status, 'accepted')
      )
    )
    .limit(1);

  let nanny1PatternId: string;
  if (existingPattern) {
    nanny1PatternId = existingPattern.id;
    console.log(
      `[skip]    nanny1 accepted pattern exists -> ${nanny1PatternId}`
    );
  } else {
    const now = new Date().toISOString();
    const [createdPattern] = await db
      .insert(schedulePatterns)
      .values({
        household_id: householdId,
        carer_id: nannyId,
        status: 'accepted',
        rrule: NANNY1_PATTERN_RRULE,
        dtstart: NANNY1_PATTERN_DTSTART,
        timezone,
        created_by: parentId,
        sent_at: now,
        responded_at: now,
      })
      .returning({ id: schedulePatterns.id });
    if (!createdPattern) throw new Error('pattern insert returned no row');
    nanny1PatternId = createdPattern.id;

    // Written straight into `schedule_pattern_days` (see module header for
    // why: no screen this flow reads needs a materialised `shifts` row).
    await db.insert(schedulePatternDays).values(
      NANNY1_PATTERN_DAYS.map(weekday => ({
        pattern_id: nanny1PatternId,
        weekday,
        start_time: NANNY1_PATTERN_START,
        end_time: NANNY1_PATTERN_END,
      }))
    );
    console.log(
      `[created] nanny1 accepted pattern -> ${nanny1PatternId} ` +
        `(Mon/Wed/Fri ${NANNY1_PATTERN_START}-${NANNY1_PATTERN_END})`
    );
  }

  console.log('\n# --- eval me (seed-s3-second-carer) ---');
  console.log(`S3_HOUSEHOLD_ID=${householdId}`);
  console.log(`S3_NANNY2_ID=${nanny2Id}`);
  console.log(`S3_NANNY1_ID=${nannyId}`);
  console.log(`S3_NANNY2_RATE_MINOR=${NANNY2_RATE_MINOR}`);
  console.log(`S3_NANNY2_DISPLAY_NAME=${NANNY2_DISPLAY_NAME}`);
  console.log(`S3_NANNY1_PATTERN_ID=${nanny1PatternId}`);
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
