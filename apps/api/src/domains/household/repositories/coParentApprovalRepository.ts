/**
 * Co-parent approval repository — data access for `co_parent_approvals`
 * (design flow 1f; supabase/migrations/022_co_parent_approvals.sql). Uses the
 * service-role Supabase client; membership/role authorization happens in the
 * SERVICE layer, never here.
 *
 * @module domains/household/repositories/coParentApprovalRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { CO_PARENT_APPROVAL_STATUSES } from '../schemas';
import type { CoParentApproval } from '../types';

export class CoParentApprovalRepository extends BaseRepository<CoParentApproval> {
  constructor() {
    super('co_parent_approvals');
  }

  /** Pending approvals for a household, newest first. */
  async listPendingByHousehold(
    householdId: string
  ): Promise<CoParentApproval[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('status', CO_PARENT_APPROVAL_STATUSES.PENDING)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list pending approvals',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as CoParentApproval[];
  }

  /** Record a parent's approve/decline response. */
  async respond(
    id: string,
    status: 'approved' | 'declined',
    respondedBy: string
  ): Promise<CoParentApproval> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({
        status,
        responded_by: respondedBy,
        responded_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new DatabaseError(
        'Failed to record approval response',
        'DATABASE_ERROR',
        { details: error.message, id }
      );
    }
    return data as CoParentApproval;
  }

  /**
   * Auto-approve-by-silence: flip every still-`pending` row whose
   * `timeout_at` has passed to `timed_out`. Scoped to one household when
   * called on-read (`coParentApprovalQueryService.listPending`), or global
   * when called by the maintenance job (Wave G) with no `householdId`.
   * Returns the rows that were just expired.
   */
  async expireTimedOut(
    now: string,
    householdId?: string
  ): Promise<CoParentApproval[]> {
    let query = supabaseService
      .from(this.table)
      .update({
        status: CO_PARENT_APPROVAL_STATUSES.TIMED_OUT,
        responded_at: now,
      })
      .eq('status', CO_PARENT_APPROVAL_STATUSES.PENDING)
      .lt('timeout_at', now);

    if (householdId) {
      query = query.eq('household_id', householdId);
    }

    const { data, error } = await query.select();

    if (error) {
      throw new DatabaseError(
        'Failed to expire timed-out approvals',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as CoParentApproval[];
  }
}
