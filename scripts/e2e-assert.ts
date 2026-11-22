#!/usr/bin/env bun
/**
 * Database-side assertions for the end-to-end simulator run.
 *
 * WHY THIS EXISTS
 * Maestro proves the UI did something. It cannot prove the right rows landed in
 * the right tables — a screen that renders "Invite code: R4K-92T" over an empty
 * `household_invites` table is a green test and a broken product. So every e2e
 * flow is asserted twice: once through the UI by Maestro, once here against the
 * database.
 *
 * This half is deliberately independent of the UI. It has no knowledge of
 * testIDs, screens, or navigation, so it stays valid while the app is rewritten.
 *
 * Reads the LOCAL D1 database (the one `wrangler dev` in apps/api persists to)
 * through scripts/lib/localDb.ts — local only by construction, never the
 * remote database. It reads raw rows, so it observes ground truth, including
 * rows the signed-in user could not see through the API.
 *
 * Usage:
 *   bun run scripts/e2e-assert.ts
 *
 * Exits non-zero if any assertion failed, so it can gate a CI step.
 *
 * @module scripts/e2e-assert
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  carerAvailability,
  children,
  householdInvites,
  householdMembers,
  schedulePatterns,
  shifts,
  user,
} from '../apps/api/src/db/schema';
import { getLocalDb } from './lib/localDb';

const PARENT_EMAIL = 'parent@steadilynanny.test';
const NANNY_EMAIL = 'nanny@steadilynanny.test';

const { db, dispose } = await getLocalDb();

// ---------------------------------------------------------------------------
// tiny assertion harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function userIdFor(email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// flow assertions
// ---------------------------------------------------------------------------

/** Flow 2 precondition: the parent created a household and owns it. */
async function assertHousehold(): Promise<string | null> {
  console.log('\nFlow: household created by the parent');
  const parentId = await userIdFor(PARENT_EMAIL);
  check('parent auth user exists', !!parentId);
  if (!parentId) return null;

  const memberships = await db
    .select({
      household_id: householdMembers.household_id,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.user_id, parentId),
        eq(householdMembers.status, 'active')
      )
    );

  check('parent has >= 1 active membership', memberships.length > 0);
  const owner = memberships.find(m => m.role === 'owner');
  check('parent is OWNER of a household', !!owner);
  if (!owner) return null;

  // The orphan case the API is built to prevent: a household with no members is
  // unreachable by anyone. Worth asserting from the outside, not just in a unit
  // test, because `households.created_by` is ON DELETE SET NULL.
  const allMembers = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.household_id, owner.household_id),
        eq(householdMembers.status, 'active')
      )
    );
  check(
    'household has at least one active member (no orphan)',
    allMembers.length > 0
  );

  return owner.household_id;
}

/** Flow 2: children were added through the UI. */
async function assertChildren(householdId: string): Promise<void> {
  console.log('\nFlow: children added');
  const data = await db
    .select({ name: children.name })
    .from(children)
    .where(
      and(eq(children.household_id, householdId), isNull(children.archived_at))
    );

  check('household has >= 1 child', data.length > 0, `found ${data.length}`);
  check(
    'every child has a non-empty name',
    data.every(c => !!c.name.trim())
  );
}

/** Flow 3: the parent generated an invite code. */
async function assertInvite(householdId: string): Promise<string | null> {
  console.log('\nFlow: invite code generated');
  const [invite] = await db
    .select({
      code: householdInvites.code,
      role: householdInvites.role,
      expires_at: householdInvites.expires_at,
    })
    .from(householdInvites)
    .where(eq(householdInvites.household_id, householdId))
    .orderBy(desc(householdInvites.created_at))
    .limit(1);

  check('an invite row exists', !!invite);
  if (!invite) return null;

  // The alphabet deliberately excludes 0/O/1/I/L — this gets read aloud and
  // typed by hand, so an ambiguous glyph is a real support cost.
  check(
    `code matches XXX-XXX with no ambiguous glyphs (${invite.code})`,
    /^[A-Z2-9]{3}-[A-Z2-9]{3}$/.test(invite.code) &&
      !/[01OIL]/.test(invite.code)
  );
  check('invite role is nanny', invite.role === 'nanny');
  check(
    'invite is not already expired',
    new Date(invite.expires_at) > new Date()
  );
  return invite.code;
}

/** Flow 4: the nanny redeemed the code and became a member. */
async function assertMembership(householdId: string): Promise<string | null> {
  console.log('\nFlow: nanny redeemed the invite');
  const nannyId = await userIdFor(NANNY_EMAIL);
  check('nanny auth user exists', !!nannyId);
  if (!nannyId) return null;

  // Redeeming twice must not create a second row — there is a unique index on
  // (user_id, household_id) and the API translates the conflict into a clean error.
  const rows = await db
    .select({ role: householdMembers.role, status: householdMembers.status })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.user_id, nannyId)
      )
    );
  const membership = rows[0];

  check(
    'nanny is an active member of the household',
    membership?.status === 'active'
  );
  check(
    'nanny joined with role=nanny (not parent/owner)',
    membership?.role === 'nanny'
  );
  check('exactly one membership row (no double-redeem)', rows.length === 1);

  const [invite] = await db
    .select({
      status: householdInvites.status,
      accepted_by: householdInvites.accepted_by,
    })
    .from(householdInvites)
    .where(eq(householdInvites.household_id, householdId))
    .orderBy(desc(householdInvites.created_at))
    .limit(1);
  check('invite marked accepted', invite?.status === 'accepted');
  check('invite records who accepted it', invite?.accepted_by === nannyId);

  return nannyId;
}

/** Flow 5: the nanny set her availability. */
async function assertAvailability(nannyId: string): Promise<void> {
  console.log('\nFlow: nanny availability saved');
  const data = await db
    .select({
      weekday: carerAvailability.weekday,
      is_available: carerAvailability.is_available,
      earliest_start: carerAvailability.earliest_start,
      latest_finish: carerAvailability.latest_finish,
    })
    .from(carerAvailability)
    .where(eq(carerAvailability.user_id, nannyId));

  check('availability rows exist', data.length > 0, `found ${data.length}`);
  check(
    'weekdays are within 0..6',
    data.every(r => r.weekday >= 0 && r.weekday <= 6)
  );
  check(
    'any available day has a finish after its start',
    data.every(
      r =>
        !r.is_available ||
        !r.earliest_start ||
        !r.latest_finish ||
        r.latest_finish > r.earliest_start
    )
  );
}

/** Flow 6: the parent sent a weekly pattern. */
async function assertPattern(householdId: string): Promise<string | null> {
  console.log('\nFlow: schedule pattern sent');
  const [pattern] = await db
    .select({
      id: schedulePatterns.id,
      status: schedulePatterns.status,
      rrule: schedulePatterns.rrule,
      timezone: schedulePatterns.timezone,
      sent_at: schedulePatterns.sent_at,
    })
    .from(schedulePatterns)
    .where(eq(schedulePatterns.household_id, householdId))
    .orderBy(desc(schedulePatterns.created_at))
    .limit(1);

  check('a schedule pattern exists', !!pattern);
  if (!pattern) return null;

  check(
    `pattern is pending or accepted (is: ${pattern.status})`,
    pattern.status === 'pending' || pattern.status === 'accepted'
  );
  check('pattern carries a real RRULE', /FREQ=/.test(pattern.rrule));
  check('pattern captured an IANA timezone', pattern.timezone.includes('/'));
  check('pattern has been sent', !!pattern.sent_at);
  return pattern.id;
}

/** Flow 7: acceptance materialised shifts at the correct UTC instants. */
async function assertShifts(
  householdId: string,
  patternId: string
): Promise<void> {
  console.log('\nFlow: shifts materialised on acceptance');
  const data = await db
    .select({
      starts_at: shifts.starts_at,
      ends_at: shifts.ends_at,
      timezone: shifts.timezone,
      local_date: shifts.local_date,
      ical_uid: shifts.ical_uid,
      carer_id: shifts.carer_id,
    })
    .from(shifts)
    .where(
      and(
        eq(shifts.household_id, householdId),
        eq(shifts.source_pattern_id, patternId)
      )
    )
    .orderBy(asc(shifts.starts_at));

  check('shifts were materialised', data.length > 0, `found ${data.length}`);
  if (!data.length) return;

  check(
    'every shift ends after it starts',
    data.every(s => s.ends_at > s.starts_at)
  );
  check(
    'every shift has a carer assigned',
    data.every(s => !!s.carer_id)
  );
  check(
    'every shift has a unique ical_uid',
    new Set(data.map(s => s.ical_uid)).size === data.length
  );

  // local_date is derived from starts_at in the shift's own timezone by the
  // service layer (src/db/localDate.ts). If it disagrees, every day-grouped
  // read is wrong.
  const mismatched = data.filter(s => {
    const local = new Date(s.starts_at).toLocaleDateString('en-CA', {
      timeZone: s.timezone,
    });
    return local !== s.local_date;
  });
  check(
    'local_date matches starts_at rendered in the shift timezone',
    mismatched.length === 0,
    mismatched.length ? `${mismatched.length} mismatched` : undefined
  );
}

/**
 * The invariants that live in the database rather than the service layer:
 * the overlap / draft-refusal / stamp triggers of migrations/0001_triggers.sql.
 * A static test proves the FILE is right; only the live database proves it was
 * applied. Every trigger the file declares must exist in sqlite_master.
 */
async function assertTriggers(): Promise<void> {
  console.log('\nSchema: 0001_triggers.sql applied');
  const file = readFileSync(
    join(import.meta.dir, '../apps/api/migrations/0001_triggers.sql'),
    'utf8'
  );
  const expected = [...file.matchAll(/^CREATE TRIGGER (\w+)/gm)].map(m => m[1]);
  const rows = await db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'trigger'`
  );
  const present = new Set(rows.map(r => r.name));
  const missing = expected.filter(n => n && !present.has(n));
  check(
    `all ${expected.length} triggers from 0001_triggers.sql exist`,
    expected.length > 0 && missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : undefined
  );
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

// Cross-family anonymity (old flow 8) is no longer asserted here: D1 has no
// v_busy_blocks view to inspect. The busy union and its column narrowing live
// in apps/api/src/domains/availability/repositories/busyBlockRepository.ts and
// are pinned by its unit tests.
async function main(): Promise<void> {
  console.log(`e2e database assertions\n${'='.repeat(48)}`);

  // Schema-level, fixture-independent — runs before the early return below so
  // it is asserted even on a database with no seeded flow data.
  await assertTriggers();

  const householdId = await assertHousehold();
  if (!householdId) {
    console.log('\nNo household yet — run the parent setup flow first.');
    return;
  }

  await assertChildren(householdId);
  await assertInvite(householdId);
  const nannyId = await assertMembership(householdId);
  if (nannyId) await assertAvailability(nannyId);

  const patternId = await assertPattern(householdId);
  if (patternId) await assertShifts(householdId, patternId);
}

try {
  await main();
} finally {
  await dispose();
}

console.log(`\n${'='.repeat(48)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
