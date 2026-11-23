#!/usr/bin/env bun
/**
 * Seed a SECOND household that the same nanny also works for.
 *
 * WHY
 * The cross-family anonymity promise is the load-bearing claim of this product:
 * the Reyes may learn Nia is unavailable, never that she is with the Coles. That
 * claim is only testable if Nia actually belongs to two households. With one
 * household there is nothing to leak, so the assertion passes vacuously — and a
 * test that cannot fail is not evidence.
 *
 * This seeds the second household directly against the database rather than
 * through the UI, deliberately: e2e flow 4 already covers joining a household by
 * invite code through the app. Flow 8 is about what a DIFFERENT family can READ,
 * so the join mechanism is not what is under test here.
 *
 * Idempotent. Safe to run repeatedly.
 *
 * Run AFTER scripts/seed-test-users.ts and after the nanny has joined the first
 * household through the app.
 *
 * Usage: bun run scripts/seed-second-household.ts
 *
 * @module scripts/seed-second-household
 */

import { and, count, eq, sql } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  children,
  householdMembers,
  households,
  shifts,
  user,
  userProfiles,
} from '../apps/api/src/db/schema';
import { ensureUser, getLocalDb } from './lib/localDb';

const NANNY_EMAIL = 'nanny@steadilynanny.test';
const OTHER_PARENT_EMAIL = 'otherparent@steadilynanny.test';
const TEST_PASSWORD = 'SteadilyTest!2026';

/** Deliberately distinctive: if any of these strings ever surfaces in the first
 *  household's UI or API responses, the anonymity promise is broken and the
 *  string makes it obvious in a screenshot or a log. */
const OTHER_HOUSEHOLD_NAME = 'LEAKCANARY the Cole household';
const OTHER_CHILD_NAME = 'LEAKCANARY-Ada';

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
  if (!nannyId) {
    console.error(
      `${NANNY_EMAIL} not found. Run scripts/seed-test-users.ts first.`
    );
    process.exit(1);
  }

  const { id: otherParentId, created } = await ensureUser(db, {
    email: OTHER_PARENT_EMAIL,
    password: TEST_PASSWORD,
    name: 'Other Parent',
  });
  console.log(
    created
      ? `[created] ${OTHER_PARENT_EMAIL} -> ${otherParentId}`
      : `[skip]    ${OTHER_PARENT_EMAIL} already exists -> ${otherParentId}`
  );
  // Profile row must exist before any household FK references this user
  // (GOLDEN-FIXES #7 — household tables target user_profiles).
  await db
    .insert(userProfiles)
    .values({
      user_id: otherParentId,
      name: 'Other Parent',
      timezone: 'Europe/London',
    })
    .onConflictDoUpdate({
      target: userProfiles.user_id,
      set: { name: 'Other Parent', timezone: 'Europe/London' },
    });

  // Household
  const [existing] = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.name, OTHER_HOUSEHOLD_NAME))
    .limit(1);

  let householdId = existing?.id ?? null;
  if (!householdId) {
    const [row] = await db
      .insert(households)
      .values({
        name: OTHER_HOUSEHOLD_NAME,
        timezone: 'Europe/London',
        created_by: otherParentId,
      })
      .returning({ id: households.id });
    if (!row) throw new Error('household insert returned no row');
    householdId = row.id;
    console.log(
      `[created] household ${OTHER_HOUSEHOLD_NAME} -> ${householdId}`
    );
  } else {
    console.log(`[skip]    household already exists -> ${householdId}`);
  }

  // Memberships: the other parent owns it, the SAME nanny also works here.
  // onConflict on (user_id, household_id) — the unique index that also makes
  // double-redeem safe in the API.
  await db
    .insert(householdMembers)
    .values([
      {
        household_id: householdId,
        user_id: otherParentId,
        role: 'owner',
        can_edit: true,
      },
      {
        household_id: householdId,
        user_id: nannyId,
        role: 'nanny',
        can_edit: false,
      },
    ])
    .onConflictDoUpdate({
      target: [householdMembers.user_id, householdMembers.household_id],
      set: { role: sql`excluded.role`, can_edit: sql`excluded.can_edit` },
    });

  // A child, so there is something with a name that could leak.
  const [child] = await db
    .select({ id: children.id })
    .from(children)
    .where(
      and(
        eq(children.household_id, householdId),
        eq(children.name, OTHER_CHILD_NAME)
      )
    )
    .limit(1);
  if (!child) {
    await db.insert(children).values({
      household_id: householdId,
      name: OTHER_CHILD_NAME,
      birth_date: '2021-01-01',
    });
  }

  // Confirmed shifts, so the nanny has real busy time in this household that
  // a household-A parent's extra-shift form can clash with (flows 35/36).
  // ROLLING, not fixed: a fixed date rots into the past, where the form's
  // 'past' warning outranks the cross-household 'busy' one. 400-699 days out
  // is far past the 84-day pattern horizon, so no materialised shift in
  // household A can collide. TWO days because flow 35 CREATES a household-A
  // shift on its day (a re-run there would hit the same-carer hard stop),
  // while flow 36 only cancels on its own day. Each run replaces this
  // seeder's previous shifts, so re-running it re-arms both flows.
  // 07:00-16:00 UTC (08:00-17:00 London in summer); local_date is the same
  // day in London either way. D1 has no local_date trigger: write it.
  await db
    .delete(shifts)
    .where(
      and(
        eq(shifts.household_id, householdId),
        eq(shifts.carer_id, nannyId),
        eq(shifts.created_by, otherParentId)
      )
    );
  const offsetDays = 400 + Math.floor(Math.random() * 300);
  const clashDate = new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const readDate = new Date(Date.parse(clashDate) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const day of [clashDate, readDate]) {
    await db.insert(shifts).values({
      household_id: householdId,
      carer_id: nannyId,
      starts_at: new Date(`${day}T07:00:00Z`).toISOString(),
      ends_at: new Date(`${day}T16:00:00Z`).toISOString(),
      timezone: 'Europe/London',
      local_date: day,
      kind: 'recurring',
      status: 'confirmed',
      origin: 'system_generated',
      created_by: otherParentId,
    });
  }
  console.log(
    `[created] confirmed shifts in the second household on ${clashDate} and ${readDate}`
  );

  const [membershipCount] = await db
    .select({ n: count() })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.user_id, nannyId),
        eq(householdMembers.status, 'active')
      )
    );

  console.log(
    `\nNanny now belongs to ${membershipCount?.n ?? 0} active household(s).`
  );
  console.log(
    'Flow 8 (cross-family anonymity) is now meaningful rather than vacuous.'
  );
  console.log(
    `Canary strings to grep for: "${OTHER_HOUSEHOLD_NAME}", "${OTHER_CHILD_NAME}"`
  );
  console.log('\n# --- eval me');
  console.log(`CROSS_HOUSEHOLD_CLASH_DATE=${clashDate}`);
  console.log(`CROSS_HOUSEHOLD_READ_DATE=${readDate}`);
}

const { db, dispose } = await getLocalDb();
try {
  await main(db);
} finally {
  await dispose();
}
