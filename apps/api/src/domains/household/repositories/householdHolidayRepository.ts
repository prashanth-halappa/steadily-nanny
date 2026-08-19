/**
 * Household-holiday repository — data access for `household_holidays` (080).
 * Uses the service-role Supabase client, so RLS is bypassed and the
 * membership/role gates live in the service layer, as everywhere else here.
 *
 * @module domains/household/repositories/householdHolidayRepository
 */
import { holidayKeysForCountry } from '@steadily-nanny/shared-types/holidayPacks';
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
   * Seed a brand-new household with the country's holiday pack, all observed
   * — what makes the Holidays group read "all on" the first time a parent
   * opens it (080, generalised past the US federal set in 107). Ignores
   * conflicts so a retried creation cannot 23505 AND cannot reset a toggle
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
   * List, then filter in TypeScript, then delete by id. PostgREST `not.in`
   * with interpolated keys is a quoting trap; an empty stale set returns
   * without a second round trip.
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

    const { error } = await supabaseService
      .from(this.table)
      .delete()
      .in('id', staleIds);

    if (error) {
      throw new DatabaseError(
        'Failed to delete stale household holidays',
        'DATABASE_ERROR',
        { details: error.message, householdId, count: staleIds.length }
      );
    }
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
