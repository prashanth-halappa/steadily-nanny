/**
 * Shift-event repository — READ-ONLY access to the `shift_events` append-only
 * day thread. There is no create/update/delete here on purpose: the schedule
 * domain's `scheduleShiftRepository.insertEvent` is the only writer
 * (`pattern_conflict` events during re-materialisation), and the DB has no
 * update/delete policy on this table at all — an editable audit trail is not
 * an audit trail (see supabase/migrations/015_shifts.sql).
 *
 * @module domains/shift/repositories/shiftEventRepository
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

export class ShiftEventRepository {
  private readonly table = 'shift_events';

  /** The day-thread entries tied to one shift, oldest first. */
  async listForShift(
    householdId: string,
    shiftId: string
  ): Promise<ShiftEvent[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list shift events', 'DATABASE_ERROR', {
        details: error.message,
        householdId,
        shiftId,
      });
    }
    return (data ?? []) as ShiftEvent[];
  }
}
