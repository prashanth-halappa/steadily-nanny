/**
 * Household repository — data access for the `households` table. Extends
 * BaseRepository for standard CRUD and adds two domain queries. Uses the
 * service-role Supabase client, so ownership/authorization is enforced in the
 * SERVICE layer, never here.
 *
 * @module domains/household/repositories/householdRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { Household } from '../types';

export class HouseholdRepository extends BaseRepository<Household> {
  constructor() {
    super('households');
  }

  /** Fetch multiple households by id — used to list a user's households via membership. */
  async findByIds(ids: string[]): Promise<Household[]> {
    if (ids.length === 0) {
      return [];
    }
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .in('id', ids)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list households by id',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return (data ?? []) as Household[];
  }

  /**
   * First names of a household's active (non-archived) children, for the
   * unauthenticated invite-preview endpoint. Queries the `children` table
   * directly rather than depending on the child domain's repository/service:
   * the child domain already imports the household domain's query service for
   * membership/role checks, so a household -> child import here would create a
   * cycle. This is a narrow, read-only exception to normal domain boundaries.
   */
  async listActiveChildFirstNames(householdId: string): Promise<string[]> {
    const { data, error } = await supabaseService
      .from('children')
      .select('name')
      .eq('household_id', householdId)
      .is('archived_at', null);

    if (error) {
      throw new DatabaseError(
        'Failed to list children for invite preview',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return ((data ?? []) as { name: string }[]).map(row => row.name);
  }
}
