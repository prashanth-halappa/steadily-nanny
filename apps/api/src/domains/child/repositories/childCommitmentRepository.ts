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
// The repository module directly, not the household barrel: the barrel pulls
// in that domain's services, and one of those reaching back for a child would
// close an import cycle (the same note `householdCommandService` carries).
import { HouseholdRepository } from '../../household/repositories/householdRepository';
import type { ChildCommitment } from '../types';

export class ChildCommitmentRepository extends BaseRepository<ChildCommitment> {
  private readonly households = new HouseholdRepository();

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
   * shape `uncoveredCareService.raiseUncoveredOnce` needs for a whole-household,
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

  /**
   * Distinct LIVE household ids that have at least one care-hours row.
   *
   * This is the enumeration point for the only two scheduled jobs that start
   * from households rather than from rows — `scheduleHorizonJob` and
   * `uncoveredDigestJob` — and its caller set is jobs-only, which is what makes
   * it the right place for the draft filter (093's CRON AUDIT; §12 "Draft,
   * cron": a draft produces no reminder, no digest, no horizon work, no nudge).
   *
   * A draft cannot legally HOLD a commitment — 093's trigger refuses the insert
   * — so in practice this filters nothing today. That is the point: it is the
   * guard for the day a write path or a service-role script gets one in, and it
   * costs one batched query rather than a digest fired at a nanny with no
   * family.
   */
  async listHouseholdIdsWithCommitments(): Promise<string[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('household_id');

    if (error) {
      throw new DatabaseError(
        'Failed to list households with commitments',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    const ids = [
      ...new Set((data ?? []).map(row => row.household_id as string)),
    ];
    return this.households.listLiveIds(ids);
  }
}
