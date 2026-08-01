/**
 * Time-tracking wire contract: clock in/out, and the weekly timesheet.
 * @module packages/shared-types/src/schemas/timesheet.schema
 *
 * Backing tables: `time_entries`, `timesheets`
 * (supabase/migrations/017_time_tracking.sql).
 *
 * "Hours only — no payments here." This records what actually happened,
 * which is deliberately NOT the same as what was scheduled — see the
 * migration's header comment before touching this. `local_date` on
 * `TimeEntrySchema` and `week_start` on `TimesheetSchema` are both
 * trigger/service derived, never client-set.
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** time_entries.kind */
export const TIME_ENTRY_KINDS = {
  WORKED: 'worked',
  CANCELLATION_PAID: 'cancellation_paid',
  MANUAL_ADJUSTMENT: 'manual_adjustment',
} as const;
export type TimeEntryKind =
  (typeof TIME_ENTRY_KINDS)[keyof typeof TIME_ENTRY_KINDS];

/** time_entries.status */
export const TIME_ENTRY_STATUSES = {
  RUNNING: 'running',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  QUERIED: 'queried',
} as const;
export type TimeEntryStatus =
  (typeof TIME_ENTRY_STATUSES)[keyof typeof TIME_ENTRY_STATUSES];

/** timesheets.status */
export const TIMESHEET_STATUSES = {
  OPEN: 'open',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  QUERIED: 'queried',
} as const;
export type TimesheetStatus =
  (typeof TIMESHEET_STATUSES)[keyof typeof TIMESHEET_STATUSES];

// =============================================================================
// time_entries
// =============================================================================

/** The persisted entity as returned to clients. */
export const TimeEntrySchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  carer_id: z.uuid(),
  // Nullable: a carer can clock in on a day with no scheduled shift.
  shift_id: z.uuid().nullable(),
  clock_in_at: z.iso.datetime({ offset: true }).nullable(),
  clock_out_at: z.iso.datetime({ offset: true }).nullable(),
  break_minutes: z.int().min(0),
  // Frozen at clock-out — must not drift if the shift is later edited.
  scheduled_minutes: z.int().nullable(),
  kind: z.enum(Object.values(TIME_ENTRY_KINDS)),
  note: z.string().nullable(),
  // Reassurance, never a gate. Null means "we did not check".
  clock_in_location_ok: z.boolean().nullable(),
  clock_out_location_ok: z.boolean().nullable(),
  status: z.enum(Object.values(TIME_ENTRY_STATUSES)),
  // Trigger-derived from clock_in_at/clock_out_at/timezone — never client-set.
  local_date: z.iso.date(),
  timezone: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST /time-entries/clock-in body. */
export const ClockInSchema = z.object({
  household_id: z.uuid(),
  shift_id: z.uuid().optional(),
});

/** POST /time-entries/:id/clock-out body — every field optional. */
export const ClockOutSchema = z.object({
  break_minutes: z.int().min(0).optional(),
  note: z.string().optional(),
});

/** List response envelope. */
export const TimeEntryListResponseSchema = z.object({
  time_entries: z.array(TimeEntrySchema),
});

export type TimeEntry = z.infer<typeof TimeEntrySchema>;
export type ClockInInput = z.infer<typeof ClockInSchema>;
export type ClockOutInput = z.infer<typeof ClockOutSchema>;
export type TimeEntryListResponse = z.infer<typeof TimeEntryListResponseSchema>;

// =============================================================================
// timesheets
// =============================================================================

/** The persisted entity as returned to clients. */
export const TimesheetSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  carer_id: z.uuid(),
  // Monday, in the household's timezone — en-GB weeks start Monday.
  week_start: z.iso.date(),
  total_minutes: z.int(),
  status: z.enum(Object.values(TIMESHEET_STATUSES)),
  approved_by: z.uuid().nullable(),
  approved_at: z.iso.datetime({ offset: true }).nullable(),
  // "Query Thursday" — an approval escape hatch that names the disagreement.
  query_note: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST /timesheets/:id/query body. */
export const QueryTimesheetSchema = z.object({
  note: z.string().min(1, 'note is required'),
});

/** List response envelope. */
export const TimesheetListResponseSchema = z.object({
  timesheets: z.array(TimesheetSchema),
});

export type Timesheet = z.infer<typeof TimesheetSchema>;
export type QueryTimesheetInput = z.infer<typeof QueryTimesheetSchema>;
export type TimesheetListResponse = z.infer<typeof TimesheetListResponseSchema>;
