/**
 * Schedule domain schemas — re-exported from the shared wire contract.
 *
 * The schedule-pattern wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/schedule.schema` — imported by BOTH
 * the API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (URL params, nested-replace bodies, response-only
 * actions) belong HERE, alongside this re-export — they must NOT go in the
 * shared package, which is kept to wire shapes only.
 *
 * @module domains/schedule/schemas
 */
import { z } from 'zod';

export type {
  AmendSchedulePatternInput,
  CreateSchedulePatternDayChildInput,
  CreateSchedulePatternDayInput,
  CreateSchedulePatternInput,
  PauseRange,
  SchedulePattern,
  SchedulePatternDay,
  SchedulePatternDayChild,
  SchedulePatternDayChildListResponse,
  SchedulePatternDayListResponse,
  SchedulePatternListResponse,
  SchedulePatternStatus,
  UpdateSchedulePatternInput,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
export {
  AmendSchedulePatternSchema,
  CreateSchedulePatternDayChildSchema,
  CreateSchedulePatternDaySchema,
  CreateSchedulePatternSchema,
  PauseRangeSchema,
  SCHEDULE_PATTERN_STATUSES,
  SchedulePatternDayChildListResponseSchema,
  SchedulePatternDayChildSchema,
  SchedulePatternDayListResponseSchema,
  SchedulePatternDaySchema,
  SchedulePatternIdParamSchema,
  SchedulePatternListResponseSchema,
  SchedulePatternSchema,
  UpdateSchedulePatternSchema,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';

/** URL param validation for /households/:householdId/schedule-patterns routes. */
export const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});

/** One nested day + its children, for the wholesale replace endpoint below. */
const ReplaceDayChildSchema = z
  .object({
    child_id: z.uuid(),
    start_time: z.iso.time().optional(),
    end_time: z.iso.time().optional(),
  })
  .refine(
    data => (data.start_time === undefined) === (data.end_time === undefined),
    {
      message: 'start_time and end_time must both be set or both omitted',
      path: ['end_time'],
    }
  );

const ReplaceDaySchema = z
  .object({
    weekday: z.int().min(0).max(6),
    start_time: z.iso.time(),
    end_time: z.iso.time(),
    children: z.array(ReplaceDayChildSchema).default([]),
  })
  .refine(data => data.end_time > data.start_time, {
    message: 'end_time must be after start_time',
    path: ['end_time'],
  });

/**
 * PUT body for `/schedule-patterns/:patternId/days` — days and their children
 * are nested resources clients replace WHOLESALE, never PATCHed piecemeal
 * (per the wave-2 spec). One row per weekday; no two rows may repeat a
 * weekday (mirrors the DB's `schedule_pattern_days_pattern_weekday_idx`
 * unique index).
 */
export const ReplaceSchedulePatternDaysSchema = z
  .object({
    days: z.array(ReplaceDaySchema),
  })
  .refine(
    data =>
      new Set(data.days.map(day => day.weekday)).size === data.days.length,
    { message: 'each weekday may appear at most once', path: ['days'] }
  );
export type ReplaceSchedulePatternDaysInput = z.infer<
  typeof ReplaceSchedulePatternDaysSchema
>;
export type ReplaceDayInput = z.infer<typeof ReplaceDaySchema>;
export type ReplaceDayChildInput = z.infer<typeof ReplaceDayChildSchema>;

/** POST body for `/schedule-patterns/:patternId/respond`. */
export const RespondToSchedulePatternSchema = z.object({
  status: z.enum(['accepted', 'declined']),
  message: z.string().optional(),
});
export type RespondToSchedulePatternInput = z.infer<
  typeof RespondToSchedulePatternSchema
>;
