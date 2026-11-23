#!/usr/bin/env bun
/**
 * Bootstrap the two households the rest of the seed chain assumes already exist.
 *
 * WHY THIS EXISTS
 * `seed-e2e-approval-fixtures.ts` and `seed-phase4-fixtures.ts` both resolve
 * "Our household" by name AND by an active nanny membership. Neither creates
 * it. On a database that has just been reset, `seed-e2e-approval-fixtures.ts`
 * prints `[skip]` and **exits 0** — a silently green run that seeds nothing,
 * after which every downstream flow fails on missing fixtures for reasons that
 * look like app defects. That trap is the whole reason this file exists.
 *
 * Until now the two households were created by hand in psql (the recipe was
 * carried in a comment block at the bottom of `apps/mobile/.env.maestro`, which
 * dies with the file it documents). This is that recipe, executable.
 *
 * Creates, idempotently:
 *   1. "Our household" — the primary household for parent@ + nanny@, with one
 *      child. The child is not decoration: `useIsOnboarded` treats an owner as
 *      set up only once the active household has >= 1 child, so a childless
 *      household sends the seed parent into the onboarding wizard on next
 *      sign-in and every flow after that fails on a missing tab bar.
 *   2. A `state='draft'` household authored by the nanny — flow 20's fixture.
 *      Draft households need no owner/parent (see migration 093's module doc),
 *      so the shape is deliberately minimal: no terms proposal, no invite.
 *
 * Run AFTER scripts/seed-test-users.ts and BEFORE the fixture seeders.
 *
 * Usage: bun run scripts/seed-launch-pass-bootstrap.ts
 *
 * @module scripts/seed-launch-pass-bootstrap
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../apps/api/src/db/client';
import {
  childCommitments,
  children,
  householdMembers,
  households,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const PARENT_EMAIL = 'parent@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';
const COPARENT_EMAIL = 'coparent@steadilynanny.test';

const HOUSEHOLD_NAME = 'Our household';
const TIMEZONE = 'Europe/London';
const CURRENCY = 'GBP';
const CHILD_NAME = 'Nia';
const CARE_HOURS_LABEL = 'Care hours';

async function requireUser(db: Db, email: string): Promise<string> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);
  if (!row) {
    console.error(`${email} not found. Run scripts/seed-test-users.ts first.`);
    process.exit(1);
  }
  return row.id;
}

/** The named household, disambiguated the same way the fixture seeders do it:
 *  by name AND an active nanny membership. Matching on name alone would adopt
 *  a stray same-named household with no nanny and reproduce the `[skip]`. */
async function ensureOurHousehold(
  db: Db,
  parentId: string,
  nannyId: string
): Promise<string> {
  const candidates = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.name, HOUSEHOLD_NAME));

  for (const candidate of candidates) {
    const [membership] = await db
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
    if (membership) {
      // Flow 29 saves `owner_only` through the app and leaves it set; a fresh
      // seed must hand every flow the default `either` again.
      await db
        .update(households)
        .set({ approval_mode: 'either' })
        .where(eq(households.id, candidate.id));
      console.log(`[skip]    "${HOUSEHOLD_NAME}" exists -> ${candidate.id}`);
      return candidate.id;
    }
  }

  const [created] = await db
    .insert(households)
    .values({
      name: HOUSEHOLD_NAME,
      timezone: TIMEZONE,
      currency: CURRENCY,
      created_by: parentId,
    })
    .returning({ id: households.id });
  if (!created) throw new Error('household insert returned no row');
  console.log(`[created] "${HOUSEHOLD_NAME}" -> ${created.id}`);
  return created.id;
}

async function ensureMembers(
  db: Db,
  householdId: string,
  parentId: string,
  nannyId: string,
  coParentId: string
): Promise<void> {
  await db
    .insert(householdMembers)
    .values([
      {
        household_id: householdId,
        user_id: parentId,
        role: 'owner',
        can_edit: true,
        status: 'active',
      },
      {
        household_id: householdId,
        user_id: nannyId,
        role: 'nanny',
        can_edit: false,
        status: 'active',
      },
      // The co-parent. `role: 'parent'` and NOT 'owner' is the whole point:
      // `approval_mode = 'owner_only'` is defined as "only the household owner
      // decides", so a second parent who is not the owner is the only account
      // that can demonstrate the refusal. seed-test-users.ts deliberately
      // creates this account with no household ("must be created through the
      // app"), which left every owner_only assertion unwritable — there was no
      // non-owner parent anywhere to refuse.
      {
        household_id: householdId,
        user_id: coParentId,
        role: 'parent',
        can_edit: true,
        status: 'active',
      },
    ])
    .onConflictDoUpdate({
      target: [householdMembers.user_id, householdMembers.household_id],
      set: {
        role: sql`excluded.role`,
        can_edit: sql`excluded.can_edit`,
        status: sql`excluded.status`,
      },
    });
  console.log('[ok]      members: parent=owner, nanny=nanny, coparent=parent');
}

async function ensureChild(db: Db, householdId: string): Promise<string> {
  const [existing] = await db
    .select({ id: children.id })
    .from(children)
    // By NAME, not "any child": flow 30 leaves a second child ("Jet") behind,
    // and an unordered first-row pick could hang the care hours on it.
    .where(
      and(eq(children.household_id, householdId), eq(children.name, CHILD_NAME))
    )
    .limit(1);
  if (existing) {
    console.log('[skip]    child exists');
    return existing.id;
  }
  const [created] = await db
    .insert(children)
    .values({
      household_id: householdId,
      name: CHILD_NAME,
      avatar_initial: CHILD_NAME.slice(0, 1),
    })
    .returning({ id: children.id });
  if (!created) throw new Error('child insert returned no row');
  console.log(`[created] child ${CHILD_NAME}`);
  return created.id;
}

/** Declared care hours for the child.
 *
 *  NOT decoration, and NOT optional. Every `child_commitments` row IS a need
 *  window (migration 070 dropped `excluded_from_cover`), and coverage is
 *  computed live as `need − covering shifts − closures`. With no commitments
 *  there is no need, so `TodayCoverage` renders nothing at all and
 *  `today-coverage` is simply absent — which is what flow 18 failed on when
 *  this household was first bootstrapped without them. That failure looked
 *  exactly like a Today-screen regression and was a missing fixture.
 *
 *  Weekday 09:00–17:00 matches the shape the manual pass describes a parent
 *  entering in S1 ("add each child and the regular hours they'll need your
 *  nanny"), and leaves room for flow 40 to WIDEN the window and produce a
 *  genuinely uncovered row. */
async function ensureCareHours(
  db: Db,
  householdId: string,
  childId: string
): Promise<void> {
  const [existing] = await db
    .select({ id: childCommitments.id })
    .from(childCommitments)
    .where(
      and(
        eq(childCommitments.child_id, childId),
        eq(childCommitments.label, CARE_HOURS_LABEL)
      )
    )
    .limit(1);
  if (existing) {
    console.log('[skip]    care hours exist');
    return;
  }
  await db.insert(childCommitments).values({
    child_id: childId,
    household_id: householdId,
    kind: 'other',
    label: CARE_HOURS_LABEL,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    start_time: '09:00',
    end_time: '17:00',
  });
  console.log(`[created] care hours ${CARE_HOURS_LABEL} weekday 09:00-17:00`);
}

/** Flow 20's fixture. A fresh local DB reset drops it; the fixture seeders
 *  never touch it (different household), so it only needs creating once per
 *  reset. */
async function ensureNannyDraftHousehold(
  db: Db,
  nannyId: string
): Promise<string> {
  const [existing] = await db
    .select({ id: households.id })
    .from(households)
    .where(
      and(eq(households.state, 'draft'), eq(households.created_by, nannyId))
    )
    .limit(1);
  if (existing) {
    console.log(`[skip]    nanny draft household exists -> ${existing.id}`);
    return existing.id;
  }

  const [created] = await db
    .insert(households)
    .values({
      name: null,
      state: 'draft',
      timezone: TIMEZONE,
      currency: 'USD',
      created_by: nannyId,
    })
    .returning({ id: households.id });
  if (!created) throw new Error('draft household insert returned no row');

  await db
    .insert(householdMembers)
    .values({
      household_id: created.id,
      user_id: nannyId,
      role: 'nanny',
      can_edit: false,
      status: 'active',
    })
    .onConflictDoNothing({
      target: [householdMembers.user_id, householdMembers.household_id],
    });

  console.log(`[created] nanny draft household -> ${created.id}`);
  return created.id;
}

async function main(db: Db): Promise<void> {
  const parentId = await requireUser(db, PARENT_EMAIL);
  const nannyId = await requireUser(db, NANNY_EMAIL);
  console.log(`[found]   parent ${PARENT_EMAIL} -> ${parentId}`);
  console.log(`[found]   nanny  ${NANNY_EMAIL} -> ${nannyId}`);

  const coParentId = await requireUser(db, COPARENT_EMAIL);
  const householdId = await ensureOurHousehold(db, parentId, nannyId);
  await ensureMembers(db, householdId, parentId, nannyId, coParentId);
  const childId = await ensureChild(db, householdId);
  await ensureCareHours(db, householdId, childId);
  const draftHouseholdId = await ensureNannyDraftHousehold(db, nannyId);

  // Same contract as seed-phase4-fixtures.ts: everything above the marker is
  // human-readable progress, everything below is eval-able KEY=VALUE.
  console.log('\n# --- eval me (seed-launch-pass-bootstrap) ---');
  console.log(`PHASE4_HOUSEHOLD_ID=${householdId}`);
  console.log(`NANNY_DRAFT_HOUSEHOLD_ID=${draftHouseholdId}`);
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
