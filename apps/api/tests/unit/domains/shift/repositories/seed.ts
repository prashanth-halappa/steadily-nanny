/**
 * Shift fixtures for the shift repository tests on the D1 test database.
 * FK parents come from the schedule domain's seeders.
 *
 * @module tests/unit/domains/shift/repositories/seed
 */
import { eq } from 'drizzle-orm';
import { shiftEvents, shifts } from '../../../../../src/db/schema';
import type { TestDb } from '../../../../helpers/testDb';
import {
  seedChild,
  seedHousehold,
  seedUser,
} from '../../schedule/repositories/seed';

export { seedChild, seedHousehold, seedUser };

/** Two households, a parent and a carer — the parents most shift rows need. */
export async function seedWorld(t: TestDb) {
  return {
    h1: await seedHousehold(t, 'h1'),
    h2: await seedHousehold(t, 'h2'),
    parent: await seedUser(t, 'parent-1'),
    carer: await seedUser(t, 'carer-1'),
  };
}

export type ShiftRow = typeof shifts.$inferSelect;

/** Insert a shift directly (bypassing the repository); defaults to a confirmed recurring 09–17 on 2026-08-03 for carer-1 in h1. */
export async function insertShift(
  t: TestDb,
  overrides: Partial<typeof shifts.$inferInsert> = {}
): Promise<ShiftRow> {
  const [row] = await t.db
    .insert(shifts)
    .values({
      household_id: 'h1',
      carer_id: 'carer-1',
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T17:00:00.000Z',
      timezone: 'Europe/London',
      local_date: '2026-08-03',
      kind: 'recurring',
      status: 'confirmed',
      origin: 'system_generated',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insertShift returned no row');
  return row;
}

export async function readShift(t: TestDb, id: string): Promise<ShiftRow> {
  const [row] = await t.db.select().from(shifts).where(eq(shifts.id, id));
  if (!row) throw new Error(`shift ${id} missing`);
  return row;
}

export async function eventsFor(t: TestDb, shiftId: string) {
  return t.db
    .select()
    .from(shiftEvents)
    .where(eq(shiftEvents.shift_id, shiftId));
}

/** Wipe shift-owned rows between tests (children/events cascade). */
export async function clearShifts(t: TestDb): Promise<void> {
  await t.d1.prepare('DELETE FROM shifts').run();
}
