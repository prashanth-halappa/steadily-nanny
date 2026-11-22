#!/usr/bin/env bun
/**
 * Seed two confirmed test accounts (parent + nanny) into the local D1 database,
 * so end-to-end simulator runs don't need an email round-trip.
 *
 * Idempotent: safe to run repeatedly. Looks each user up by email first and
 * skips/updates rather than erroring on duplicate creation.
 *
 * Deliberately does NOT create households, children, invites, or schedules —
 * those must be created through the app during the e2e test itself.
 *
 * Usage: bun run scripts/seed-test-users.ts
 */

import { userProfiles } from '../apps/api/src/db/schema';
import { ensureUser, getLocalDb } from './lib/localDb';

const TEST_PASSWORD = 'SteadilyTest!2026';
const TIMEZONE = 'Europe/London';

// The manual pre-launch cast (docs/LAUNCH-MANUAL-PASS.md): enough accounts to
// stand up two households with two parents and two nannies, so the n-parent /
// n-nanny / two-family combinations can all be driven without inventing
// accounts mid-run. Children and households are still created through the app.
const TEST_USERS = [
  { email: 'parent@steadilynanny.test', name: 'Test Parent' },
  { email: 'nanny@steadilynanny.test', name: 'Test Nanny' },
  { email: 'coparent@steadilynanny.test', name: 'Test Co-Parent' },
  { email: 'nanny2@steadilynanny.test', name: 'Test Nanny Two' },
  { email: 'otherparent@steadilynanny.test', name: 'Other Parent' },
] as const;

async function main() {
  const { db, dispose } = await getLocalDb();
  try {
    const seededIds = new Map<string, string>();

    for (const testUser of TEST_USERS) {
      const { id: userId, created } = await ensureUser(db, {
        email: testUser.email,
        password: TEST_PASSWORD,
        name: testUser.name,
      });
      console.log(
        created
          ? `[created] auth user: ${testUser.email} (${userId})`
          : `[skip] auth user already exists: ${testUser.email} (${userId})`
      );
      seededIds.set(testUser.email, userId);

      // Every household table FKs to user_profiles — the profile row must exist
      // before any later insert (GOLDEN-FIXES.md #7).
      await db
        .insert(userProfiles)
        .values({ user_id: userId, name: testUser.name, timezone: TIMEZONE })
        .onConflictDoUpdate({
          target: userProfiles.user_id,
          set: { name: testUser.name, timezone: TIMEZONE },
        });
      console.log(`[ok] user_profiles row present: ${testUser.email}`);
    }

    console.log(
      '\nDone. Seeded users (password is the same for all, not printed here):'
    );
    for (const testUser of TEST_USERS) {
      console.log(`  ${testUser.email} -> ${seededIds.get(testUser.email)}`);
    }
  } finally {
    await dispose();
  }
}

if (import.meta.main) {
  main().catch(err => {
    console.error(
      'seed-test-users failed:',
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}
