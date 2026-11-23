#!/usr/bin/env bun
/**
 * Fixture for tests/31b-second-nanny-joins-only.yaml: put nanny2 back in the
 * wizard and mint the pending NANNY invite on "Our household" she redeems.
 *
 *  1. Deletes nanny2's membership row(s) in "Our household" (flow 31 / 31b's
 *     own output), so sign-in lands on `role-screen` again.
 *     Also deletes her schedule_patterns and shifts there (left by
 *     seed-s3-second-carer.ts / flows 32-33), so the re-joined nanny2 is a
 *     genuinely new carer: no usual week, no shifts — flow 31 asserts the
 *     "haven't set your weekly schedule yet" empty state.
 *  2. Revokes every still-pending nanny invite this script minted before, and
 *     inserts a fresh one, invited_by the parent.
 *  3. Prints S3_INVITE_CODE for `-e S3_INVITE_CODE=…`.
 *
 * Flows 32+ (seed-s3-second-carer.ts) need nanny2's membership: run 31b (or
 * 31) to completion after this, before them — the flow re-creates it.
 *
 * Usage: D1_REMOTE=1 CLOUDFLARE_ACCOUNT_ID=… bun run scripts/seed-s3-invite.ts
 *
 * @module scripts/seed-s3-invite
 */

import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  householdInvites,
  householdMembers,
  households,
  schedulePatterns,
  shifts,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const NANNY2_EMAIL = 'nanny2@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';
const PARENT_EMAIL = 'parent@steadilynanny.test';
const HOUSEHOLD_NAME = 'Our household';
const LABEL = 'seed-s3-invite';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomInviteCode(): string {
  const pick = (): string =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)] ?? 'X';
  const group = (): string => `${pick()}${pick()}${pick()}`;
  return `${group()}-${group()}`;
}

async function userId(db: Db, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row?.id ?? null;
}

async function main(db: Db): Promise<void> {
  const nanny2Id = await userId(db, NANNY2_EMAIL);
  const nannyId = await userId(db, NANNY_EMAIL);
  const parentId = await userId(db, PARENT_EMAIL);
  if (!nanny2Id || !nannyId || !parentId) {
    console.error('Cast missing. Run scripts/seed-test-users.ts first.');
    process.exit(1);
  }

  // "Our household" = the one nanny@ is an active member of (same
  // disambiguation as seed-s3-second-carer.ts).
  const candidates = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.name, HOUSEHOLD_NAME));
  let householdId: string | null = null;
  for (const c of candidates) {
    const [m] = await db
      .select({ user_id: householdMembers.user_id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, c.id),
          eq(householdMembers.user_id, nannyId),
          eq(householdMembers.status, 'active')
        )
      )
      .limit(1);
    if (m) {
      householdId = c.id;
      break;
    }
  }
  if (!householdId) {
    console.error(`No "${HOUSEHOLD_NAME}" with ${NANNY_EMAIL} as a member.`);
    process.exit(1);
  }

  await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.user_id, nanny2Id)
      )
    );

  const nanny2Patterns = await db
    .select({ id: schedulePatterns.id })
    .from(schedulePatterns)
    .where(
      and(
        eq(schedulePatterns.household_id, householdId),
        eq(schedulePatterns.carer_id, nanny2Id)
      )
    );
  const patternIds = nanny2Patterns.map(p => p.id);
  await db
    .delete(shifts)
    .where(
      and(
        eq(shifts.household_id, householdId),
        patternIds.length > 0
          ? or(
              eq(shifts.carer_id, nanny2Id),
              inArray(shifts.source_pattern_id, patternIds)
            )
          : eq(shifts.carer_id, nanny2Id)
      )
    );
  if (patternIds.length > 0) {
    await db
      .delete(schedulePatterns)
      .where(inArray(schedulePatterns.id, patternIds));
  }
  console.log(
    `[reset] nanny2 schedule_patterns (${patternIds.length}) and shifts cleared`
  );

  await db
    .update(householdInvites)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(householdInvites.household_id, householdId),
        eq(householdInvites.label, LABEL),
        eq(householdInvites.status, 'pending')
      )
    );

  const code = randomInviteCode();
  const now = Date.now();
  await db.insert(householdInvites).values({
    household_id: householdId,
    code,
    role: 'nanny',
    status: 'pending',
    invited_by: parentId,
    label: LABEL,
    expires_at: new Date(now + 30 * 86_400_000).toISOString(),
    link_expires_at: new Date(now + 7 * 86_400_000).toISOString(),
  });

  console.log(`[reset] nanny2 membership removed from ${householdId}`);
  console.log('\n# --- eval me (seed-s3-invite) ---');
  console.log(`S3_INVITE_CODE=${code}`);
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
