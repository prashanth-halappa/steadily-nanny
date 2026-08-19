/**
 * Household-custom-holiday repository — data access for
 * `household_custom_holidays` (107). Uses the service-role Supabase client,
 * so RLS is bypassed and the membership/role gates live in the service
 * layer, as everywhere else here.
 *
 * A replace-set, not a toggle: the row existing IS the observance. An empty
 * payload deletes every row for the household — that is how the last custom
 * day is removed.
 *
 * @module domains/household/repositories/householdCustomHolidayRepository
 */
import type { HouseholdCustomHoliday } from '@steadily-nanny/shared-types/schemas/householdHoliday.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export interface HouseholdCustomHolidayEntry {
  name: string;
  dates: readonly string[];
}

export class HouseholdCustomHolidayRepository extends BaseRepository<HouseholdCustomHoliday> {
  constructor() {
    super('household_custom_holidays');
  }

  /** This household's authored days, name-ascending. */
  async listForHousehold(
    householdId: string
  ): Promise<HouseholdCustomHoliday[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .order('name', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list household custom holidays',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as HouseholdCustomHoliday[];
  }

  /**
   * Replace this household's custom days with `entries`. Upserts on
   * `(household_id, name)`, then drops rows whose name is not in the payload.
   *
   * List, then filter in TypeScript, then delete by id — PostgREST `not.in`
   * with user-supplied names is a quoting trap. An empty payload deletes
   * every row. `updated_at` is owned by 107's trigger, not written here.
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

    const { error } = await supabaseService
      .from(this.table)
      .delete()
      .in('id', staleIds);

    if (error) {
      throw new DatabaseError(
        'Failed to delete stale household custom holidays',
        'DATABASE_ERROR',
        { details: error.message, householdId, count: staleIds.length }
      );
    }

    return this.listForHousehold(householdId);
  }

  /**
   * `updated_at` is deliberately absent from the written columns: 107's
   * `set_household_custom_holidays_updated_at` trigger fires on UPDATE and
   * owns it. Writing it here would be a second clock that can disagree with
   * Postgres.
   *
   * `onConflict` names the plain unique CONSTRAINT `(household_id, name)`.
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

    const { data, error } = await supabaseService
      .from(this.table)
      .upsert(rows, { onConflict: 'household_id,name' })
      .select();

    if (error) {
      throw new DatabaseError(
        'Failed to upsert household custom holidays',
        'DATABASE_ERROR',
        { details: error.message, householdId, count: rows.length }
      );
    }
    return (data ?? []) as HouseholdCustomHoliday[];
  }
}
