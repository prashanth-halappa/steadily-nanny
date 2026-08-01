/**
 * Household invite repository — data access for the `household_invites`
 * table. Uses the service-role Supabase client; the invite lookup-by-code
 * deliberately runs under the service role (no RLS policy lets a stranger
 * select an invite by code), which is also what keeps codes non-enumerable.
 *
 * @module domains/household/repositories/householdInviteRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { HouseholdInvite } from '../types';

export class HouseholdInviteRepository extends BaseRepository<HouseholdInvite> {
  constructor() {
    super('household_invites');
  }

  /** Look up an invite by its human-transcribable code. */
  async findByCode(code: string): Promise<HouseholdInvite | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up invite by code',
        'DATABASE_ERROR',
        { details: error.message, code }
      );
    }
    return data as HouseholdInvite | null;
  }
}
