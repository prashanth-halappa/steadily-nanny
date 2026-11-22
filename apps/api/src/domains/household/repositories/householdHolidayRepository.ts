/**
 * Household-holiday repository — data access for `household_holidays` (080).
 * No RLS on D1: the membership/role gates live in the service layer, as
 * everywhere else here.
 *
 * @module domains/household/repositories/householdHolidayRepository
 */
import { holidayKeysForCountry } from '@steadily-nanny/shared-types/holidayPacks';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { chunk } from '../../../db/chunk';
import { db } from '../../../db/client';
import { householdHolidays } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { HouseholdHoliday } from '../types';

export interface HouseholdHolidayToggle {
  holiday_key: string;
  observed: boolean;
}

export class HouseholdHolidayRepository extends BaseRepository<
  HouseholdHoliday,
  typeof householdHolidays
> {
  constructor() {
    super(householdHolidays);
  }

  /** This household's toggles, key-ascending. */
  async listForHousehold(householdId: string): Promise<HouseholdHoliday[]> {
    try {
      const rows = await db
        .select()
        .from(householdHolidays)
        .where(eq(householdHolidays.household_id, householdId))
        .orderBy(asc(householdHolidays.holiday_key));
      return rows as HouseholdHoliday[];
    } catch (err) {
      throw this.dbError('Failed to list', err, {
        householdId,
        operation: 'listForHousehold',
      });
    }
  }

  /**
   * Set the named toggles, overwriting whichever already exist. Keys NOT named
   * are untouched — this is an upsert, never a delete-then-insert, so a client
   * that knows about ten of eleven holidays cannot silently switch off the
   * eleventh (`householdHoliday.schema.ts`).
   */
  async upsertMany(
    householdId: string,
    entries: readonly HouseholdHolidayToggle[]
  ): Promise<HouseholdHoliday[]> {
    return this.upsertRows(householdId, entries, false);
  }

  /**
   * Seed a brand-new household with the country's holiday pack, all observed
   * — what makes the Holidays group read "all on" the first time a parent
   * opens it (080, generalised past the US federal set in 107). Ignores
   * conflicts so a retried creation cannot hit the unique AND cannot reset a toggle
   * somebody has already changed.
   */
  async seedCountryPack(
    householdId: string,
    country: string
  ): Promise<HouseholdHoliday[]> {
    return this.upsertRows(
      householdId,
      holidayKeysForCountry(country).map(holiday_key => ({
        holiday_key,
        observed: true,
      })),
      true
    );
  }

  /**
   * Drop this household's toggles whose key is not in `keys` — the leftover
   * rows after a country change, whose pack no longer contains them.
   *
   * List, then filter in TypeScript, then delete by id; an empty stale set
   * returns without a second round trip.
   */
  async deleteKeysNotIn(
    householdId: string,
    keys: readonly string[]
  ): Promise<void> {
    const rows = await this.listForHousehold(householdId);
    const keep = new Set(keys);
    const staleIds = rows
      .filter(row => !keep.has(row.holiday_key))
      .map(row => row.id);
    if (staleIds.length === 0) {
      return;
    }

    try {
      for (const page of chunk(staleIds)) {
        await db
          .delete(householdHolidays)
          .where(inArray(householdHolidays.id, page));
      }
    } catch (err) {
      throw this.dbError('Failed to delete stale', err, {
        householdId,
        count: staleIds.length,
        operation: 'deleteKeysNotIn',
      });
    }
  }

  /**
   * `updated_at` is deliberately absent from the written columns: the
   * `set_household_holidays_updated_at` trigger stamps it on UPDATE (it only
   * stamps when the statement did not set it, MIGRATION-NOTES §3).
   *
   * The conflict target is the plain unique `(household_id, holiday_key)`, not
   * an expression index, so `ON CONFLICT … DO NOTHING` really does mean "skip".
   * SQLite's `RETURNING` omits skipped rows, exactly as PostgREST's
   * `ignoreDuplicates` did.
   */
  private async upsertRows(
    householdId: string,
    entries: readonly HouseholdHolidayToggle[],
    ignoreDuplicates: boolean
  ): Promise<HouseholdHoliday[]> {
    const rows = entries.map(entry => ({
      household_id: householdId,
      holiday_key: entry.holiday_key,
      observed: entry.observed,
    }));

    if (rows.length === 0) return [];
    const target = [
      householdHolidays.household_id,
      householdHolidays.holiday_key,
    ];
    try {
      const insert = db.insert(householdHolidays).values(rows);
      const result = await (ignoreDuplicates
        ? insert.onConflictDoNothing({ target })
        : insert.onConflictDoUpdate({
            target,
            set: { observed: sql`excluded.observed` },
          })
      ).returning();
      return result as HouseholdHoliday[];
    } catch (err) {
      throw this.dbError('Failed to upsert', err, {
        householdId,
        count: rows.length,
        operation: 'upsertRows',
      });
    }
  }
}
