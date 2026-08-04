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
      .select('id, household_id')
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
}
