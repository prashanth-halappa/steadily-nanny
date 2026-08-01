/**
 * Schedule domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { SchedulePattern } from '../types'` following the
 * domain-anatomy convention.
 *
 * @module domains/schedule/types
 */
export type {
  CreateSchedulePatternDayChildInput,
  CreateSchedulePatternDayInput,
  CreateSchedulePatternInput,
  PauseRange,
  ReplaceDayChildInput,
  ReplaceDayInput,
  ReplaceSchedulePatternDaysInput,
  RespondToSchedulePatternInput,
  SchedulePattern,
  SchedulePatternDay,
  SchedulePatternDayChild,
  SchedulePatternDayChildListResponse,
  SchedulePatternDayListResponse,
  SchedulePatternListResponse,
  SchedulePatternStatus,
  UpdateSchedulePatternInput,
} from '../schemas';
