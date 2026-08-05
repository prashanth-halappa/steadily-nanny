/**
 * Carer time-off repository — data access for the `carer_time_off` table.
 * Uses the service-role Supabase client, so ownership/authorization is
 * enforced in the SERVICE layer, never here.
 *
 * @module domains/availability/repositories/carerTimeOffRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { CARER_TIME_OFF_STATUSES } from '../schemas';
import type { CarerTimeOff } from '../types';

export class CarerTimeOffRepository extends BaseRepository<CarerTimeOff> {
  constructor() {
    super('carer_time_off');
  }

  /** All of a user's time-off rows (including cancelled ones), earliest first. */
  async listByUserId(userId: string): Promise<CarerTimeOff[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('user_id', userId)
      .order('starts_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list carer time off',
        'DATABASE_ERROR',
        { details: error.message, userId }
      );
    }
    return (data ?? []) as CarerTimeOff[];
  }

  /**
   * Time-off rows for any of the given user ids (household carers). Includes
   * cancelled rows so a parent can see history; callers may filter.
   */
  async listByUserIds(userIds: string[]): Promise<CarerTimeOff[]> {
    if (userIds.length === 0) return [];
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .in('user_id', userIds)
      .order('starts_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list household carer time off',
        'DATABASE_ERROR',
        { details: error.message, userIds }
      );
    }
    return (data ?? []) as CarerTimeOff[];
  }

  /**
   * Soft-cancel: sets `status = 'cancelled'`. Never a hard delete — the
   * partial index `carer_time_off_user_range_idx ... where status <>
   * 'cancelled'` implies cancelled rows persist (see
   * supabase/migrations/011_availability.sql). Ownership is verified by the
   * caller (service layer) before this runs.
   *
   * CONDITIONAL ON THE ROW NOT ALREADY BEING CANCELLED, and returns `null`
   * when nothing matched (Phase 3/4 review, BLOCKER 1). This write is a
   * STATE TRANSITION, not an assignment, because a real side effect hangs
   * off it: `timeOffCommandService.cancel` fires the PTO reconciliation
   * afterwards. Without the guard, a retried cancel — the client times out
   * and taps again, which is the normal case, not the exotic one —
   * "succeeded" a second time and re-fired that reconciliation against a
   * ledger that had already been corrected. `null` is how the service learns
   * it changed nothing and must not reconcile again; the same shape as
   * `timesheetRepository.approveSubmittedWithEarnings` and
   * `shiftRepository.confirmPending`.
   */
  async cancelById(id: string): Promise<CarerTimeOff | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: CARER_TIME_OFF_STATUSES.CANCELLED })
      .eq('id', id)
      .neq('status', CARER_TIME_OFF_STATUSES.CANCELLED)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to cancel carer time off',
        'DATABASE_ERROR',
        { details: error.message, id }
      );
    }
    return data as CarerTimeOff | null;
  }
}
