/**
 * Narrow read of confirmed shifts overlapping a carer's time-off range.
 * Lives in availability (not shift) so the conflict scan does not widen
 * the shift domain's public surface — selects only id + household_id.
 *
 * @module domains/availability/repositories/overlappingShiftRepository
 */
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../../../db/client';
import { shifts } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { toInstant } from './busyBlockRepository';

/** Minimal shift identity needed to group conflict counts by household. */
export interface OverlappingBookedShift {
  id: string;
  household_id: string;
  /**
   * D-23: N10's body names the EARLIEST affected date ("3 shifts from Tue 12
   * Aug"), so the batch push needs more than a count. `local_date` is the
   * household-local day the shift belongs to, written by the app on every shift write (shiftLocalDate).
   */
  starts_at: string;
  local_date: string;
  timezone: string;
}

function dbError(
  message: string,
  err: unknown,
  metadata: Record<string, unknown>
): DatabaseError {
  const error = new DatabaseError(message, 'DATABASE_ERROR', {
    ...metadata,
    details: err instanceof Error ? err.message : String(err),
  });
  error.cause = err;
  return error;
}

export class OverlappingShiftRepository {
  /**
   * Confirmed shifts assigned to `carerId` overlapping `[from, to)`.
   * Overlap semantics match `busyBlockRepository.listForCarer` /
   * `ShiftRepository.findByHouseholdAndRange`: starts before `to` AND
   * ends after `from` (strict).
   */
  async listConfirmedForCarerInRange(
    carerId: string,
    from: string,
    to: string
  ): Promise<OverlappingBookedShift[]> {
    try {
      return await db
        .select({
          id: shifts.id,
          household_id: shifts.household_id,
          starts_at: shifts.starts_at,
          local_date: shifts.local_date,
          timezone: shifts.timezone,
        })
        .from(shifts)
        .where(
          and(
            eq(shifts.carer_id, carerId),
            eq(shifts.status, SHIFT_STATUSES.CONFIRMED),
            lt(shifts.starts_at, toInstant(to)),
            gt(shifts.ends_at, toInstant(from))
          )
        );
    } catch (err) {
      throw dbError('Failed to list overlapping booked shifts for carer', err, {
        carerId,
        from,
        to,
      });
    }
  }

  /**
   * D77a — demote one CONFIRMED shift to pending. A single conditional
   * UPDATE (`WHERE status = 'confirmed'`), never read-then-write: atomic and
   * idempotent under concurrency, and a no-op (returns `false`) if the shift
   * already moved off `confirmed` by the time this runs — including a shift
   * this same call already demoted on a retry. Callers must only audit a
   * transition THIS call actually made, never assume one happened.
   */
  async demoteConfirmedToPending(shiftId: string): Promise<boolean> {
    try {
      const rows = await db
        .update(shifts)
        .set({ status: SHIFT_STATUSES.PENDING })
        .where(
          and(
            eq(shifts.id, shiftId),
            eq(shifts.status, SHIFT_STATUSES.CONFIRMED)
          )
        )
        .returning({ id: shifts.id });
      return rows.length > 0;
    } catch (err) {
      throw dbError('Failed to demote overlapping shift to pending', err, {
        shiftId,
      });
    }
  }
}
