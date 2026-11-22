/**
 * Carer time-off repository — data access for the `carer_time_off` table.
 * Ownership/authorization is enforced in the SERVICE layer, never here.
 *
 * @module domains/availability/repositories/carerTimeOffRepository
 */
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../../db/client';
import { carerTimeOff } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { CARER_TIME_OFF_STATUSES } from '../schemas';
import type { CarerTimeOff } from '../types';

export class CarerTimeOffRepository extends BaseRepository<
  CarerTimeOff,
  typeof carerTimeOff
> {
  constructor() {
    super(carerTimeOff);
  }

  /** All of a user's time-off rows (including cancelled ones), earliest first. */
  async listByUserId(userId: string): Promise<CarerTimeOff[]> {
    try {
      const rows = await db
        .select()
        .from(this.table)
        .where(eq(this.table.user_id, userId))
        .orderBy(asc(this.table.starts_at));
      return rows as CarerTimeOff[];
    } catch (err) {
      throw this.dbError('Failed to list', err, { userId });
    }
  }

  /**
   * Time-off rows for any of the given user ids (household carers). Includes
   * cancelled rows so a parent can see history; callers may filter.
   */
  async listByUserIds(userIds: string[]): Promise<CarerTimeOff[]> {
    if (userIds.length === 0) return [];
    try {
      const rows = await db
        .select()
        .from(this.table)
        .where(inArray(this.table.user_id, userIds))
        .orderBy(asc(this.table.starts_at));
      return rows as CarerTimeOff[];
    } catch (err) {
      throw this.dbError('Failed to list', err, { userIds });
    }
  }

  /**
   * Soft-cancel: sets `status = 'cancelled'`. Never a hard delete — the
   * partial index `carer_time_off_user_range_idx ... where status <>
   * 'cancelled'` implies cancelled rows persist (see
   * the old Postgres migration 011_availability.sql). Ownership is verified by the
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
    try {
      const rows = await db
        .update(this.table)
        .set({ status: CARER_TIME_OFF_STATUSES.CANCELLED })
        .where(
          and(
            eq(this.table.id, id),
            ne(this.table.status, CARER_TIME_OFF_STATUSES.CANCELLED)
          )
        )
        .returning();
      return (rows[0] as CarerTimeOff | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to cancel', err, { id });
    }
  }
}
