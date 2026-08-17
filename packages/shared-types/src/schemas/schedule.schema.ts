/**
 * Recurring schedule pattern ("usual week") wire contract.
 * @module packages/shared-types/src/schemas/schedule.schema
 *
 * Backing tables: `schedule_patterns`, `schedule_pattern_days`,
 * `schedule_pattern_day_children` (supabase/migrations/014_schedule_patterns.sql).
 *
 * Pattern-day times (`schedule_pattern_days.start_time` / `.end_time` and
 * `schedule_pattern_day_children.start_time` / `.end_time`) are NOMINAL LOCAL
 * WALL-CLOCK times, deliberately not instants — "Thursdays 8:00-17:00" has to
 * remain 8am local across a GMT/BST transition. See the header comment on
 * `schedule_pattern_days` in migration 014 before touching these fields.
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** schedule_patterns.status */
export const SCHEDULE_PATTERN_STATUSES = {
  DRAFT: 'draft',
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
  ENDED: 'ended',
} as const;
export type SchedulePatternStatus =
  (typeof SCHEDULE_PATTERN_STATUSES)[keyof typeof SCHEDULE_PATTERN_STATUSES];

/** One term-time pause, e.g. school holidays. Both bounds are calendar dates. */
export const PauseRangeSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});
export type PauseRange = z.infer<typeof PauseRangeSchema>;

// =============================================================================
// schedule_patterns
// =============================================================================

/** The persisted entity as returned to clients. */
export const SchedulePatternSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // The carer this week is proposed to. Nullable so a parent can sketch a
  // usual week before any nanny exists.
  carer_id: z.uuid().nullable(),
  status: z.enum(Object.values(SCHEDULE_PATTERN_STATUSES)),
  // iCalendar RRULE, e.g. 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH'.
  rrule: z.string().min(1),
  dtstart: z.iso.date(),
  until: z.iso.date().nullable(),
  exdates: z.array(z.iso.date()),
  pause_ranges: z.array(PauseRangeSchema),
  // Copied from the household at creation; not client-settable afterwards.
  timezone: z.string().min(1),
  note: z.string().nullable(),
  /** Carer's optional note when declining; null unless status is declined. */
  decline_message: z.string().nullable(),
  created_by: z.uuid().nullable(),
  sent_at: z.iso.datetime({ offset: true }).nullable(),
  responded_at: z.iso.datetime({ offset: true }).nullable(),
  ical_uid: z.string(),
  sequence: z.int(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/**
 * Shared write fields for create/update. Kept as a plain ZodObject so
 * Update can `.extend().partial()` — Create wraps this with the
 * until>=dtstart refine (mirrors DB `schedule_patterns_date_order`).
 */
const SchedulePatternWriteFieldsSchema = z.object({
  carer_id: z.uuid().optional(),
  rrule: z.string().min(1, 'rrule is required'),
  dtstart: z.iso.date(),
  until: z.iso.date().optional(),
  exdates: z.array(z.iso.date()).optional(),
  pause_ranges: z.array(PauseRangeSchema).optional(),
  note: z.string().optional(),
});

/**
 * POST body — what a client sends to sketch/create one. `timezone` is
 * deliberately absent: it is copied server-side from the household so that a
 * later change to the household's zone can never retroactively move an
 * already-agreed schedule.
 */
export const CreateSchedulePatternSchema =
  SchedulePatternWriteFieldsSchema.refine(
    data => data.until === undefined || data.until >= data.dtstart,
    { message: 'until must be on or after dtstart', path: ['until'] }
  );

/**
 * PATCH body — every field optional, but at least one must be present.
 * `status` is deliberately NOT one of these fields — accepting a pattern
 * must only ever happen through `respond()` (carer-only, requires
 * `pending`, and drives materialisation). Zod strips unknown keys by
 * default, so a client-sent `status` is silently dropped here rather than
 * reaching the command service.
 */
export const UpdateSchedulePatternSchema =
  SchedulePatternWriteFieldsSchema.partial()
    .refine(data => Object.keys(data).length > 0, {
      message: 'at least one field is required',
    })
    .refine(
      data =>
        data.until === undefined ||
        data.dtstart === undefined ||
        data.until >= data.dtstart,
      { message: 'until must be on or after dtstart', path: ['until'] }
    );

/**
 * POST body for amending an *accepted* pattern — holiday skips, term-time
 * pauses, and end date only. Day/time reopen stays a new draft proposal.
 * `until >= dtstart` is enforced in the command service against the
 * persisted pattern's `dtstart` (this body has no `dtstart` field).
 */
export const AmendSchedulePatternSchema = z
  .object({
    until: z.iso.date().nullable().optional(),
    exdates: z.array(z.iso.date()).optional(),
    pause_ranges: z.array(PauseRangeSchema).optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  });
export type AmendSchedulePatternInput = z.infer<
  typeof AmendSchedulePatternSchema
>;

/** URL param validation for /schedule-patterns/:patternId routes. */
export const SchedulePatternIdParamSchema = z.object({
  patternId: z.uuid(),
});

/** List response envelope. */
export const SchedulePatternListResponseSchema = z.object({
  schedule_patterns: z.array(SchedulePatternSchema),
});

export type SchedulePattern = z.infer<typeof SchedulePatternSchema>;
export type CreateSchedulePatternInput = z.infer<
  typeof CreateSchedulePatternSchema
>;
export type UpdateSchedulePatternInput = z.infer<
  typeof UpdateSchedulePatternSchema
>;
export type SchedulePatternListResponse = z.infer<
  typeof SchedulePatternListResponseSchema
>;

// =============================================================================
// schedule_pattern_days
// =============================================================================

/**
 * The persisted entity as returned to clients. A weekday may appear more than
 * once if there are multiple blocks; blocks come back ordered by start_time.
 */
export const SchedulePatternDaySchema = z.object({
  id: z.uuid(),
  pattern_id: z.uuid(),
  // 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow).
  weekday: z.int().min(0).max(6),
  start_time: z.iso.time(),
  end_time: z.iso.time(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const SchedulePatternDayInputSchema = z.object({
  weekday: z.int().min(0).max(6),
  start_time: z.iso.time(),
  end_time: z.iso.time(),
});

/**
 * POST body — what a client sends to create one. The end > start guard here
 * is a light client-side mirror of the DB's `schedule_pattern_days_time_order`
 * check — the database remains authoritative.
 */
export const CreateSchedulePatternDaySchema =
  SchedulePatternDayInputSchema.refine(
    data => data.end_time > data.start_time,
    { message: 'end_time must be after start_time', path: ['end_time'] }
  );

/** PATCH body — every field optional, but at least one must be present. */
export const UpdateSchedulePatternDaySchema =
  SchedulePatternDayInputSchema.partial().refine(
    data => Object.keys(data).length > 0,
    { message: 'at least one field is required' }
  );

/** URL param validation for /schedule-pattern-days/:patternDayId routes. */
export const SchedulePatternDayIdParamSchema = z.object({
  patternDayId: z.uuid(),
});

/** List response envelope. */
export const SchedulePatternDayListResponseSchema = z.object({
  schedule_pattern_days: z.array(SchedulePatternDaySchema),
});

export type SchedulePatternDay = z.infer<typeof SchedulePatternDaySchema>;
export type CreateSchedulePatternDayInput = z.infer<
  typeof CreateSchedulePatternDaySchema
>;
export type UpdateSchedulePatternDayInput = z.infer<
  typeof UpdateSchedulePatternDaySchema
>;
export type SchedulePatternDayListResponse = z.infer<
  typeof SchedulePatternDayListResponseSchema
>;

// =============================================================================
// schedule_pattern_day_children
// =============================================================================
// Which children are covered on a given pattern day, and for which part of
// it. NULL start/end means "the whole shift"; both null or both set is the
// only legal pairing (DB `..._time_pairing` check). No Update schema: these
// rows are narrow enough that clients replace them wholesale rather than
// PATCHing individual fields.

/** The persisted entity as returned to clients. */
export const SchedulePatternDayChildSchema = z.object({
  id: z.uuid(),
  pattern_day_id: z.uuid(),
  child_id: z.uuid(),
  start_time: z.iso.time().nullable(),
  end_time: z.iso.time().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/**
 * POST body — what a client sends to create one. `start_time` and
 * `end_time` must both be present or both omitted, mirroring the DB's
 * `..._time_pairing` check.
 */
export const CreateSchedulePatternDayChildSchema = z
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

/** URL param validation for /schedule-pattern-day-children/:patternDayChildId routes. */
export const SchedulePatternDayChildIdParamSchema = z.object({
  patternDayChildId: z.uuid(),
});

/** List response envelope. */
export const SchedulePatternDayChildListResponseSchema = z.object({
  schedule_pattern_day_children: z.array(SchedulePatternDayChildSchema),
});

export type SchedulePatternDayChild = z.infer<
  typeof SchedulePatternDayChildSchema
>;
export type CreateSchedulePatternDayChildInput = z.infer<
  typeof CreateSchedulePatternDayChildSchema
>;
export type SchedulePatternDayChildListResponse = z.infer<
  typeof SchedulePatternDayChildListResponseSchema
>;
