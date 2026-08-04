/**
 * Household-closure repository — data access for `household_closures`.
 * Uses the service-role Supabase client; membership/role gates live in
 * the service layer.
 *
 * @module domains/availability/repositories/householdClosureRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { HouseholdClosure } from '../types';

export class HouseholdClosureRepository extends BaseRepository<HouseholdClosure> {
  constructor() {
    super('household_closures');
  }

  /** All closures for a household, earliest first. */
  async listByHousehold(householdId: string): Promise<HouseholdClosure[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .order('starts_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list household closures',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as HouseholdClosure[];
  }
}
