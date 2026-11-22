/**
 * Schedule-pattern-day repository — data access for `schedule_pattern_days`.
 * Days are a NESTED resource clients replace wholesale (never PATCHed
 * piecemeal): `replaceForPattern` deletes the pattern's existing days —
 * cascading away their children via the DB's `on delete cascade` — and
 * inserts the new set in one batch (all-or-nothing on D1).
 *
 * @module domains/schedule/repositories/schedulePatternDayRepository
 */
import type { SchedulePatternDay } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { schedulePatternDays } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { chunk } from './chunk';

export interface NewSchedulePatternDayData {
  weekday: number;
  start_time: string;
  end_time: string;
}

const details = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export class SchedulePatternDayRepository {
  async listForPattern(patternId: string): Promise<SchedulePatternDay[]> {
    try {
      return (await db
        .select()
        .from(schedulePatternDays)
        .where(eq(schedulePatternDays.pattern_id, patternId))
        .orderBy(
          asc(schedulePatternDays.weekday),
          asc(schedulePatternDays.start_time)
        )) as SchedulePatternDay[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list schedule pattern days',
        'DATABASE_ERROR',
        { details: details(err), patternId }
      );
    }
  }

  /** Delete the pattern's current days, then insert the replacement set. Returns the newly-inserted rows. */
  async replaceForPattern(
    patternId: string,
    days: NewSchedulePatternDayData[]
  ): Promise<SchedulePatternDay[]> {
    const clear = db
      .delete(schedulePatternDays)
      .where(eq(schedulePatternDays.pattern_id, patternId));
    try {
      if (days.length === 0) {
        await clear;
        return [];
      }
      // 5 params per row -> chunks of 18 stay under D1's 100-param cap.
      const [, ...inserted] = await db.batch([
        clear,
        ...chunk(days, 18).map(page =>
          db
            .insert(schedulePatternDays)
            .values(page.map(day => ({ pattern_id: patternId, ...day })))
            .returning()
        ),
      ]);
      return inserted.flat() as SchedulePatternDay[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to replace schedule pattern days',
        'DATABASE_ERROR',
        { details: details(err), patternId }
      );
    }
  }
}
