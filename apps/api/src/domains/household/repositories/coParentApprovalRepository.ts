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
import { ApprovalNotPendingError } from '../errors/approvalErrors';
import { CO_PARENT_APPROVAL_STATUSES } from '../schemas';
import type { CoParentApproval } from '../types';

/** How many times a parked payload may be applied before the approval gives up. */
const MAX_APPLY_ATTEMPTS = 2;

/** How long a retried approval waits before a sweep may pick it up again. */
const APPLY_RETRY_DELAY_MS = 15 * 60_000;

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

  /**
   * Record a parent's approve/decline response. Compare-and-set on
   * `status = pending` so a concurrent timeout/respond cannot silently
   * overwrite a settled row.
   */
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
      .eq('status', CO_PARENT_APPROVAL_STATUSES.PENDING)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to record approval response',
        'DATABASE_ERROR',
        { details: error.message, id }
      );
    }
    if (!data) {
      throw new ApprovalNotPendingError(id, 'unknown');
    }
    return data as CoParentApproval;
  }

  /**
   * Compensating write for a row this process CLAIMED (CAS'd to `approved` in
   * `respond`, or to `timed_out` in `expireTimedOut`) whose applier then threw,
   * leaving the parked payload unapplied.
   *
   * The first failure goes back to `pending` so the payload is retried; the
   * last one settles TERMINALLY as `withdrawn`, marked with the error. Bounded
   * on purpose: the appliers are not idempotent (an `extra_shift` applier that
   * fails after its `createShift` leaves a real shift behind), so an unbounded
   * retry multiplies rows on a family's schedule every time anyone opens the
   * approvals list. Two attempts covers a transient blip; a payload that
   * genuinely can't apply stops instead of looping.
   *
   * `timeout_at` is pushed forward on a retry — leaving it in the past means
   * the next on-read expiry re-applies immediately, which is the loop itself.
   * That does hand the approval a fresh silence window, deliberately: an
   * attempt is only spent when something might have half-written, so the clock
   * can be extended at most `MAX_APPLY_ATTEMPTS` times before the row settles.
   * The one unbounded case is `countsAttempt = false`, where waiting for a
   * deploy is exactly the point.
   *
   * `countsAttempt` is false when nothing could have been written — today,
   * an action with no registered applier. Spending attempts there would turn a
   * registration bug into permanently `withdrawn` mutations two taps later,
   * and there is no partial state to protect against.
   *
   * The outcome comes from the row the CAS actually returned, never from the
   * counter we intended to write: if the row moved on (a concurrent sweep or
   * respond), the update lands on nothing, `apply_attempts` is never
   * persisted, and reporting anything but `missed` would both mislead the log
   * and let the next failure restart the count from one.
   *
   * ponytail: the attempt count and error live in the existing `payload` jsonb
   * (appliers read their own keys and ignore these); real columns would need a
   * migration. Same reason `withdrawn` is the terminal marker — the status
   * check constraint has no `apply_failed`.
   */
  async recordFailedApply(
    approval: Pick<CoParentApproval, 'id' | 'payload'>,
    fromStatus: 'approved' | 'timed_out',
    reason: string,
    countsAttempt = true
  ): Promise<'retrying' | 'failed' | 'missed'> {
    const previous = approval.payload.apply_attempts;
    const spent = typeof previous === 'number' ? previous : 0;
    const attempts = countsAttempt ? spent + 1 : spent;
    const retrying = !countsAttempt || attempts < MAX_APPLY_ATTEMPTS;
    const payload = {
      ...approval.payload,
      apply_attempts: attempts,
      apply_error: reason,
    };

    const { data, error } = await supabaseService
      .from(this.table)
      .update(
        retrying
          ? {
              status: CO_PARENT_APPROVAL_STATUSES.PENDING,
              responded_by: null,
              responded_at: null,
              timeout_at: new Date(
                Date.now() + APPLY_RETRY_DELAY_MS
              ).toISOString(),
              payload,
            }
          : { status: CO_PARENT_APPROVAL_STATUSES.WITHDRAWN, payload }
      )
      .eq('id', approval.id)
      .eq('status', fromStatus)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to record a failed approval apply',
        'DATABASE_ERROR',
        { details: error.message, id: approval.id }
      );
    }
    if (!data) return 'missed';
    return retrying ? 'retrying' : 'failed';
  }

  /**
   * Drop the bookkeeping `recordFailedApply` parked in `payload` once an apply
   * finally succeeds, so a stale error string doesn't outlive the failure it
   * describes. No-ops when there is nothing to clear, which is the normal path.
   */
  async clearApplyMarkers(
    approval: Pick<CoParentApproval, 'id' | 'payload'>
  ): Promise<void> {
    if (
      approval.payload.apply_attempts === undefined &&
      approval.payload.apply_error === undefined
    ) {
      return;
    }

    const payload = { ...approval.payload };
    delete payload.apply_attempts;
    delete payload.apply_error;

    const { error } = await supabaseService
      .from(this.table)
      .update({ payload })
      .eq('id', approval.id);

    if (error) {
      throw new DatabaseError(
        'Failed to clear approval apply markers',
        'DATABASE_ERROR',
        { details: error.message, id: approval.id }
      );
    }
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
