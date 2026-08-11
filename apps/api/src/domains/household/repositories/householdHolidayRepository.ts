/**
 * Household-holiday repository — data access for `household_holidays` (080).
 * Uses the service-role Supabase client, so RLS is bypassed and the
 * membership/role gates live in the service layer, as everywhere else here.
 *
 * @module domains/household/repositories/householdHolidayRepository
 */
import { US_FEDERAL_HOLIDAY_KEYS } from '@steadily-nanny/shared-types/usFederalHolidays';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { HouseholdHoliday } from '../types';

export interface HouseholdHolidayToggle {
  holiday_key: string;
  observed: boolean;
}

export class HouseholdHolidayRepository extends BaseRepository<HouseholdHoliday> {
  constructor() {
    super('household_holidays');
  }

  /** This household's toggles, key-ascending. */
  async listForHousehold(householdId: string): Promise<HouseholdHoliday[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .order('holiday_key', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list household holidays',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as HouseholdHoliday[];
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
   * Seed a brand-new household with the federal set, all observed — what makes
   * the Holidays group read "all on" the first time a parent opens it (080).
   * Ignores conflicts so a retried creation cannot 23505 AND cannot reset a
   * toggle somebody has already changed.
   */
  async seedFederalSet(householdId: string): Promise<HouseholdHoliday[]> {
    return this.upsertRows(
      householdId,
      US_FEDERAL_HOLIDAY_KEYS.map(holiday_key => ({
        holiday_key,
        observed: true,
      })),
      true
    );
  }

  /**
   * `updated_at` is deliberately absent from the written columns: 080's
   * `set_household_holidays_updated_at` trigger fires on UPDATE and owns it.
   * Writing it here would be a second clock that can disagree with Postgres.
   *
   * `onConflict` names a plain unique CONSTRAINT, not an expression index, so
   * unlike GOLDEN-FIXES #31's case the target really does apply and
   * `ignoreDuplicates` really does mean "skip", not "raise".
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

    const { data, error } = await supabaseService
      .from(this.table)
      .upsert(
        rows,
        ignoreDuplicates
          ? { onConflict: 'household_id,holiday_key', ignoreDuplicates: true }
          : { onConflict: 'household_id,holiday_key' }
      )
      .select();

    if (error) {
      throw new DatabaseError(
        'Failed to upsert household holidays',
        'DATABASE_ERROR',
        { details: error.message, householdId, count: rows.length }
      );
    }
    return (data ?? []) as HouseholdHoliday[];
  }
}
