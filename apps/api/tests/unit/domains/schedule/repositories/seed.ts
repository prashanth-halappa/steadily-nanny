/**
 * Minimal FK parents for the schedule repository tests on the D1 test
 * database: a user + profile, a household, a child and a pattern.
 *
 * @module tests/unit/domains/schedule/repositories/seed
 */
import type { TestDb } from '../../../../helpers/testDb';

export async function seedUser(t: TestDb, id: string): Promise<string> {
  await t.d1
    .prepare('INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)')
    .bind(id, id, `${id}@example.com`)
    .run();
  await t.d1
    .prepare('INSERT INTO user_profiles (user_id) VALUES (?)')
    .bind(id)
    .run();
  return id;
}

export async function seedHousehold(t: TestDb, id: string): Promise<string> {
  await t.d1
    .prepare('INSERT INTO households (id, name) VALUES (?, ?)')
    .bind(id, id)
    .run();
  return id;
}

export async function seedChild(
  t: TestDb,
  id: string,
  householdId: string
): Promise<string> {
  await t.d1
    .prepare('INSERT INTO children (id, household_id, name) VALUES (?, ?, ?)')
    .bind(id, householdId, id)
    .run();
  return id;
}

export async function seedPattern(
  t: TestDb,
  id: string,
  householdId: string,
  opts: { carerId?: string | null; status?: string; createdAt?: string } = {}
): Promise<string> {
  await t.d1
    .prepare(
      `INSERT INTO schedule_patterns (id, household_id, carer_id, status, rrule, dtstart, timezone, ical_uid, created_at)
       VALUES (?, ?, ?, ?, 'FREQ=WEEKLY', '2026-06-01', 'Europe/London', ?, ?)`
    )
    .bind(
      id,
      householdId,
      opts.carerId ?? null,
      opts.status ?? 'draft',
      `uid-${id}`,
      opts.createdAt ?? new Date().toISOString()
    )
    .run();
  return id;
}
