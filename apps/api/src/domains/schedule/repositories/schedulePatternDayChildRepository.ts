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
import { inArray } from 'drizzle-orm';
import { db } from '../../../db/client';
import { schedulePatternDayChildren } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { chunk } from './chunk';

export interface NewSchedulePatternDayChildData {
  child_id: string;
  start_time?: string;
  end_time?: string;
}

export class SchedulePatternDayChildRepository {
  async insertForDay(
    patternDayId: string,
    children: NewSchedulePatternDayChildData[]
  ): Promise<SchedulePatternDayChild[]> {
    if (children.length === 0) {
      return [];
    }
    try {
      return (await db
        .insert(schedulePatternDayChildren)
        .values(
          children.map(child => ({ pattern_day_id: patternDayId, ...child }))
        )
        .returning()) as SchedulePatternDayChild[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to insert schedule pattern day children',
        'DATABASE_ERROR',
        {
          details: err instanceof Error ? err.message : String(err),
          patternDayId,
        }
      );
    }
  }

  /** Children across a set of pattern-day ids, for assembling a full pattern detail read. */
  async listForDays(
    patternDayIds: string[]
  ): Promise<SchedulePatternDayChild[]> {
    if (patternDayIds.length === 0) {
      return [];
    }
    try {
      const pages = await Promise.all(
        chunk(patternDayIds).map(ids =>
          db
            .select()
            .from(schedulePatternDayChildren)
            .where(inArray(schedulePatternDayChildren.pattern_day_id, ids))
        )
      );
      return pages.flat() as SchedulePatternDayChild[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list schedule pattern day children',
        'DATABASE_ERROR',
        { details: err instanceof Error ? err.message : String(err) }
      );
    }
  }
}
