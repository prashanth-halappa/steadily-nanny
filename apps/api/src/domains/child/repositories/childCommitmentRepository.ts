/**
 * Child-commitment repository — data access for the `child_commitments`
 * table (a child's fixed weekly life: preschool, school, activities, naps —
 * see `supabase/migrations/010_children.sql`'s header comment). Extends
 * BaseRepository for standard CRUD and adds the household/child list reads
 * `childCommitmentQueryService` and `coverageGapService` need. Uses the
 * service-role Supabase client, so membership/role authorization is
 * enforced in the SERVICE layer, never here — same convention as
 * `childRepository`.
 *
 * @module domains/child/repositories/childCommitmentRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { ChildCommitment } from '../types';

export class ChildCommitmentRepository extends BaseRepository<ChildCommitment> {
  constructor() {
    super('child_commitments');
  }

  /** A child's commitments, oldest-created first. */
  async findByChildId(childId: string): Promise<ChildCommitment[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('child_id', childId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list commitments for child',
        'DATABASE_ERROR',
        { details: error.message, childId }
      );
    }
    return (data ?? []) as ChildCommitment[];
  }

  /**
   * Every commitment in a household, across all its children — the input
   * shape `coverageGapService.raiseGapsOnce` needs for a whole-household,
   * one-day gap sweep (a job iterates households, not children one at a
   * time).
   */
  async findByHouseholdId(householdId: string): Promise<ChildCommitment[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list commitments for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as ChildCommitment[];
  }
}
