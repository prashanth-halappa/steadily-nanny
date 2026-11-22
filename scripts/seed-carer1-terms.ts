#!/usr/bin/env bun
/**
 * FALLBACK ONLY. Give the household's FIRST nanny a pay arrangement, when
 * `tests/07-terms-setup-and-ca-ot-week.yaml` could not be driven.
 *
 * READ THIS BEFORE RUNNING IT
 * Flow 07 drives `PaySetupScreen` through the real form and is the only thing
 * that proves that form works. This script makes flow 07 PERMANENTLY
 * unrunnable on this database, because `PaySetupScreen` redirects to
 * `/settings/pay` on mount the moment an arrangement exists. So running this
 * trades away that coverage. Only do it when flow 07 has already failed and
 * something downstream is blocked by the missing arrangement.
 *
 * WHY IT WAS NEEDED (2026-08-21): flow 07 could not be completed. The
 * simulator's QuickType prediction bar was still rendering despite all three
 * documented `simctl … defaults write` keys verifying as `false`, and
 * `hideKeyboard` is a no-op on that screen (its own flow comments record this
 * for the date field). Taps aimed at fields landed on the keyboard instead;
 * the run died asserting `pay-setup-backdating-hint`, i.e. after the rate but
 * with the effective date never correctly entered.
 *
 * WHAT DEPENDS ON THE ARRANGEMENT EXISTING
 *   - the terms gate (`termsGateService.assertAgreed`) — clock-in,
 *     add-missed-hours and edit-entry all refuse without it
 *   - every priced week in S5 (flows 09/11/12 have nothing to price)
 *   - S3's separation assertion, which compares carer 1's rate against
 *     carer 2's (1500 vs 2250 minor — deliberately no shared digits)
 *
 * £15.00/hr matches `PHASE4_HOURLY_RATE` so any flow that asserts the seeded
 * rate keeps asserting the same number flow 07 would have produced.
 *
 * Idempotent.
 *
 * Usage: bun run scripts/seed-carer1-terms.ts
 *
 * @module scripts/seed-carer1-terms
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  householdMembers,
  households,
  payArrangements,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';

const RATE_MINOR = 1500;
const CARER_DISPLAY_NAME = 'Test Nanny';
const VALID_FROM = '2026-01-01';

async function findUserByEmail(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

async function main(db: Db): Promise<void> {
  const nannyId = await findUserByEmail(db, NANNY_EMAIL);
  const parentId = await findUserByEmail(db, PARENT_EMAIL);
  if (!nannyId || !parentId) {
    console.error('Cast missing. Run scripts/seed-test-users.ts first.');
    process.exit(1);
  }

  const candidates = await db
    .select({ id: households.id, currency: households.currency })
    .from(households)
    .where(eq(households.name, HOUSEHOLD_NAME));

  let householdId: string | null = null;
  let currency = 'GBP';
  for (const candidate of candidates) {
    const [m] = await db
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
    if (m) {
      householdId = candidate.id;
      currency = candidate.currency ?? 'GBP';
      break;
    }
  }
  if (!householdId) {
    console.error(`No "${HOUSEHOLD_NAME}" with ${NANNY_EMAIL} as a member.`);
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: payArrangements.id, rate_minor: payArrangements.rate_minor })
    .from(payArrangements)
    .where(
      and(
        eq(payArrangements.household_id, householdId),
        eq(payArrangements.carer_id, nannyId)
      )
    )
    .orderBy(desc(payArrangements.valid_from))
    .limit(1);

  if (existing) {
    console.log(
      `[skip]    carer 1 arrangement exists -> ${existing.id} (${existing.rate_minor} minor)`
    );
  } else {
    const [created] = await db
      .insert(payArrangements)
      .values({
        household_id: householdId,
        carer_id: nannyId,
        rate_minor: RATE_MINOR,
        currency,
        valid_from: VALID_FROM,
        carer_display_name: CARER_DISPLAY_NAME,
        created_by: parentId,
      })
      .returning({ id: payArrangements.id });
    console.log(
      `[created] carer 1 arrangement -> ${created?.id} (${RATE_MINOR} minor ${currency})`
    );
    console.log(
      '[warn]    tests/07-terms-setup-and-ca-ot-week.yaml is now unrunnable ' +
        'on this database — PaySetupScreen redirects once an arrangement exists.'
    );
  }
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
