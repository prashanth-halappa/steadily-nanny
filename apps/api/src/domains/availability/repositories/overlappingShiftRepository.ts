/**
 * Narrow read of confirmed shifts overlapping a carer's time-off range.
 * Lives in availability (not shift) so the conflict scan does not widen
 * the shift domain's public surface — selects only id + household_id.
 *
 * @module domains/availability/repositories/overlappingShiftRepository
 */
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

/** Minimal shift identity needed to group conflict counts by household. */
export interface OverlappingBookedShift {
  id: string;
  household_id: string;
  /**
   * D-23: N10's body names the EARLIEST affected date ("3 shifts from Tue 12
   * Aug"), so the batch push needs more than a count. `local_date` is the
   * household-local day the shift belongs to, already trigger-maintained.
   */
  starts_at: string;
  local_date: string;
  timezone: string;
}

export class OverlappingShiftRepository {
  private readonly table = 'shifts';

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
    const { data, error } = await supabaseService
      .from(this.table)
      .select('id, household_id, starts_at, local_date, timezone')
      .eq('carer_id', carerId)
      .eq('status', SHIFT_STATUSES.CONFIRMED)
      .lt('starts_at', to)
      .gt('ends_at', from);

    if (error) {
      throw new DatabaseError(
        'Failed to list overlapping booked shifts for carer',
        'DATABASE_ERROR',
        { details: error.message, carerId, from, to }
      );
    }

    return (data ?? []) as OverlappingBookedShift[];
  }

  /**
   * D77a — demote one CONFIRMED shift to pending. A single conditional
   * UPDATE (`.eq('status', 'confirmed')`), never read-then-write: atomic and
   * idempotent under concurrency, and a no-op (returns `false`) if the shift
   * already moved off `confirmed` by the time this runs — including a shift
   * this same call already demoted on a retry. Callers must only audit a
   * transition THIS call actually made, never assume one happened.
   */
  async demoteConfirmedToPending(shiftId: string): Promise<boolean> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: SHIFT_STATUSES.PENDING })
      .eq('id', shiftId)
      .eq('status', SHIFT_STATUSES.CONFIRMED)
      .select('id');

    if (error) {
      throw new DatabaseError(
        'Failed to demote overlapping shift to pending',
        'DATABASE_ERROR',
        { details: error.message, shiftId }
      );
    }

    return (data ?? []).length > 0;
  }
}
