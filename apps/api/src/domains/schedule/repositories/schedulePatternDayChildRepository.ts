/**
 * Schedule-pattern-day-child repository — data access for
 * `schedule_pattern_day_children`. Rows are always inserted fresh against a
 * newly-created `pattern_day_id` (see `schedulePatternDayRepository.replaceForPattern`,
 * which already deleted-and-cascaded the old ones), so there is no
 * update/delete surface here — only insert and list.
 *
 * @module domains/schedule/repositories/schedulePatternDayChildRepository
 */
import type { SchedulePatternDayChild } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

export interface NewSchedulePatternDayChildData {
  child_id: string;
  start_time?: string;
  end_time?: string;
}

export class SchedulePatternDayChildRepository {
  private readonly table = 'schedule_pattern_day_children';

  async insertForDay(
    patternDayId: string,
    children: NewSchedulePatternDayChildData[]
  ): Promise<SchedulePatternDayChild[]> {
    if (children.length === 0) {
      return [];
    }

    const { data, error } = await supabaseService
      .from(this.table)
      .insert(
        children.map(child => ({ pattern_day_id: patternDayId, ...child }))
      )
      .select();

    if (error) {
      throw new DatabaseError(
        'Failed to insert schedule pattern day children',
        'DATABASE_ERROR',
        { details: error.message, patternDayId }
      );
    }
    return (data ?? []) as SchedulePatternDayChild[];
  }

  /** Children across a set of pattern-day ids, for assembling a full pattern detail read. */
  async listForDays(
    patternDayIds: string[]
  ): Promise<SchedulePatternDayChild[]> {
    if (patternDayIds.length === 0) {
      return [];
    }

    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .in('pattern_day_id', patternDayIds);

    if (error) {
      throw new DatabaseError(
        'Failed to list schedule pattern day children',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return (data ?? []) as SchedulePatternDayChild[];
  }
}
