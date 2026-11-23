#!/usr/bin/env bun
/**
 * Fixture for tests/32-nanny-leaves-household.yaml: a disposable nanny who is
 * an active member of exactly one disposable household, so the flow can end
 * that membership without touching the shared cast.
 *
 * WHY FRESH ACCOUNTS: the flow's whole point is a destructive write. Pointed at
 * nanny@ in "Our household" it would end the membership every later flow
 * depends on; pointed at any other shared household it would change nanny@'s
 * switcher and global Today inbox for every flow after it. A new parent + nanny
 * + household per run is re-runnable and pollutes nothing.
 *
 * Seeds: parent (owner) + nanny (active), one child (so the owner counts as
 * onboarded) and an agreed pay arrangement (so the nanny's Today is the
 * ordinary clock, not the terms gate). Prints, for `-e`:
 *   LEAVE_NANNY_EMAIL, LEAVE_HOUSEHOLD_ID   (password: SteadilyTest!2026)
 *
 * Usage: D1_REMOTE=1 CLOUDFLARE_ACCOUNT_ID=… bun run scripts/seed-leave-household.ts
 *
 * @module scripts/seed-leave-household
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

async function main(db: Db): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const nannyEmail = `leave-nanny-${suffix}@steadilynanny.test`;
  const parentId = await createUser(
    db,
    `leave-parent-${suffix}@steadilynanny.test`,
    'Leave Parent'
  );
  const nannyId = await createUser(db, nannyEmail, 'Leave Nanny');

  const [household] = await db
    .insert(households)
    .values({
      name: 'Leaving household',
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
  await db.insert(children).values({
    household_id: household.id,
    name: 'Leave Kid',
    avatar_initial: 'L',
  });
  await db.insert(payArrangements).values({
    household_id: household.id,
    carer_id: nannyId,
    rate_minor: 1500,
    currency: CURRENCY,
    valid_from: '2026-01-01',
    carer_display_name: 'Leave Nanny',
    created_by: parentId,
  });

  console.log('\n# --- eval me (seed-leave-household) ---');
  console.log(`LEAVE_NANNY_EMAIL=${nannyEmail}`);
  console.log(`LEAVE_HOUSEHOLD_ID=${household.id}`);
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
