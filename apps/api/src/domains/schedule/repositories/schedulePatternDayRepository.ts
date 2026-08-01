/**
 * Schedule-pattern-day repository — data access for `schedule_pattern_days`.
 * Days are a NESTED resource clients replace wholesale (never PATCHed
 * piecemeal): `replaceForPattern` deletes the pattern's existing days —
 * cascading away their children via the DB's `on delete cascade` — and
 * inserts the new set in one call.
 *
 * @module domains/schedule/repositories/schedulePatternDayRepository
 */
import type { SchedulePatternDay } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

export interface NewSchedulePatternDayData {
  weekday: number;
  start_time: string;
  end_time: string;
}

export class SchedulePatternDayRepository {
  private readonly table = 'schedule_pattern_days';

  async listForPattern(patternId: string): Promise<SchedulePatternDay[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('pattern_id', patternId)
      .order('weekday', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list schedule pattern days',
        'DATABASE_ERROR',
        { details: error.message, patternId }
      );
    }
    return (data ?? []) as SchedulePatternDay[];
  }

  /** Delete the pattern's current days, then insert the replacement set. Returns the newly-inserted rows. */
  async replaceForPattern(
    patternId: string,
    days: NewSchedulePatternDayData[]
  ): Promise<SchedulePatternDay[]> {
    const { error: deleteError } = await supabaseService
      .from(this.table)
      .delete()
      .eq('pattern_id', patternId);

    if (deleteError) {
      throw new DatabaseError(
        'Failed to clear existing schedule pattern days',
        'DATABASE_ERROR',
        { details: deleteError.message, patternId }
      );
    }

    if (days.length === 0) {
      return [];
    }

    const { data, error } = await supabaseService
      .from(this.table)
      .insert(days.map(day => ({ pattern_id: patternId, ...day })))
      .select();

    if (error) {
      throw new DatabaseError(
        'Failed to insert schedule pattern days',
        'DATABASE_ERROR',
        { details: error.message, patternId }
      );
    }
    return (data ?? []) as SchedulePatternDay[];
  }
}
