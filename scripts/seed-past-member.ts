#!/usr/bin/env bun
/**
 * Fixture for tests/41-past-member-surfaces.yaml: a disposable nanny who is
 * ACTIVE in one household and REMOVED from another at the same time (the
 * two-family past-member case).
 *
 * Fresh accounts per run, so nothing in the shared cast changes. The past
 * household has no shifts at all, so Schedule's layer-4 refusal (which only
 * replaces the EMPTY state) is what renders. Both households get a child and
 * an agreed pay arrangement, so the active family's Today is the ordinary
 * clock, not the terms gate.
 *
 * Prints, for `-e`:
 *   PAST_MEMBER_NANNY_EMAIL, ACTIVE_HOUSEHOLD_ID, PAST_HOUSEHOLD_ID
 *   (password: SteadilyTest!2026)
 *
 * Usage: bun run scripts/seed-past-member.ts
 *
 * @module scripts/seed-past-member
 */

import type { Db } from '../apps/api/src/db/client';
import {
  children,
  householdMembers,
  households,
  payArrangements,
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

async function seedHousehold(
  db: Db,
  name: string,
  parentId: string,
  nannyId: string,
  past: boolean
): Promise<string> {
  const [household] = await db
    .insert(households)
    .values({
      name,
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
      ...(past
        ? {
            status: 'removed',
            ended_reason: 'removed_by_parent',
            ended_at: new Date().toISOString(),
            ended_by: parentId,
          }
        : { status: 'active' }),
    },
  ]);
  await db.insert(children).values({
    household_id: household.id,
    name: `${name} Kid`,
    avatar_initial: name.charAt(0),
  });
  await db.insert(payArrangements).values({
    household_id: household.id,
    carer_id: nannyId,
    rate_minor: 1500,
    currency: CURRENCY,
    valid_from: '2026-01-01',
    carer_display_name: 'Past Member Nanny',
    created_by: parentId,
  });
  return household.id;
}

async function main(db: Db): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const nannyEmail = `past-nanny-${suffix}@steadilynanny.test`;
  const nannyId = await createUser(db, nannyEmail, 'Past Member Nanny');
  const activeParent = await createUser(
    db,
    `active-parent-${suffix}@steadilynanny.test`,
    'Active Parent'
  );
  const pastParent = await createUser(
    db,
    `past-parent-${suffix}@steadilynanny.test`,
    'Past Parent'
  );

  const activeId = await seedHousehold(
    db,
    'Current family',
    activeParent,
    nannyId,
    false
  );
  const pastId = await seedHousehold(
    db,
    'Former family',
    pastParent,
    nannyId,
    true
  );

  console.log('\n# --- eval me (seed-past-member) ---');
  console.log(`PAST_MEMBER_NANNY_EMAIL=${nannyEmail}`);
  console.log(`ACTIVE_HOUSEHOLD_ID=${activeId}`);
  console.log(`PAST_HOUSEHOLD_ID=${pastId}`);
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
