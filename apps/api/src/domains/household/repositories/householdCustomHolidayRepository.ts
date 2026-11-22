/**
 * Household-custom-holiday repository — data access for
 * `household_custom_holidays` (107). No RLS on D1: the membership/role gates
 * live in the service layer, as everywhere else here.
 *
 * A replace-set, not a toggle: the row existing IS the observance. An empty
 * payload deletes every row for the household — that is how the last custom
 * day is removed.
 *
 * @module domains/household/repositories/householdCustomHolidayRepository
 */
import type { HouseholdCustomHoliday } from '@steadily-nanny/shared-types/schemas/householdHoliday.schema';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { householdCustomHolidays } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export interface HouseholdCustomHolidayEntry {
  name: string;
  dates: readonly string[];
}

export class HouseholdCustomHolidayRepository extends BaseRepository<
  HouseholdCustomHoliday,
  typeof householdCustomHolidays
> {
  constructor() {
    super(householdCustomHolidays);
  }

  /** This household's authored days, name-ascending. */
  async listForHousehold(
    householdId: string
  ): Promise<HouseholdCustomHoliday[]> {
    try {
      const rows = await db
        .select()
        .from(householdCustomHolidays)
        .where(eq(householdCustomHolidays.household_id, householdId))
        .orderBy(asc(householdCustomHolidays.name));
      return rows as HouseholdCustomHoliday[];
    } catch (err) {
      throw this.dbError('Failed to list', err, {
        householdId,
        operation: 'listForHousehold',
      });
    }
  }

  /**
   * Replace this household's custom days with `entries`. Upserts on
   * `(household_id, name)`, then drops rows whose name is not in the payload.
   *
   * List, then filter in TypeScript, then delete by id. An empty payload
   * deletes every row. `updated_at` is owned by the trigger, not written here.
   */
  async replaceSet(
    householdId: string,
    entries: readonly HouseholdCustomHolidayEntry[]
  ): Promise<HouseholdCustomHoliday[]> {
    if (entries.length > 0) {
      await this.upsertRows(householdId, entries);
    }

    const existing = await this.listForHousehold(householdId);
    const keep = new Set(entries.map(entry => entry.name));
    const staleIds = existing
      .filter(row => !keep.has(row.name))
      .map(row => row.id);
    if (staleIds.length === 0) {
      return existing;
    }

    try {
      await db
        .delete(householdCustomHolidays)
        .where(inArray(householdCustomHolidays.id, staleIds));
    } catch (err) {
      throw this.dbError('Failed to delete stale', err, {
        householdId,
        count: staleIds.length,
        operation: 'replaceSet',
      });
    }

    return this.listForHousehold(householdId);
  }

  /**
   * `updated_at` is deliberately absent from the written columns: the
   * `set_household_custom_holidays_updated_at` trigger stamps it on UPDATE.
   *
   * The conflict target is the plain unique `(household_id, name)`.
   */
  private async upsertRows(
    householdId: string,
    entries: readonly HouseholdCustomHolidayEntry[]
  ): Promise<HouseholdCustomHoliday[]> {
    const rows = entries.map(entry => ({
      household_id: householdId,
      name: entry.name,
      dates: [...entry.dates],
    }));

    try {
      const result = await db
        .insert(householdCustomHolidays)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            householdCustomHolidays.household_id,
            householdCustomHolidays.name,
          ],
          set: { dates: sql`excluded.dates` },
        })
        .returning();
      return result as HouseholdCustomHoliday[];
    } catch (err) {
      throw this.dbError('Failed to upsert', err, {
        householdId,
        count: rows.length,
        operation: 'upsertRows',
      });
    }
  }
}
