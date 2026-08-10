/**
 * Timesheet domain schemas — re-exported from the shared wire contract.
 *
 * The time-entry/timesheet wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/timesheet.schema` — imported by BOTH
 * the API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (URL params, query validation) belong HERE, alongside
 * this re-export — they must NOT go in the shared package, which is kept to
 * wire shapes only. See the `InviteCodeParamSchema` precedent in
 * `domains/household/schemas.ts`.
 *
 * @module domains/timesheet/schemas
 */
import { z } from 'zod';

export type {
  ApproveTimesheetInput,
  ClockInInput,
  ClockOutInput,
  CreateRetroactiveTimeEntryInput,
  QueryTimesheetInput,
  ReopenTimesheetInput,
  TimeEntry,
  TimeEntryKind,
  TimeEntryListResponse,
  TimeEntryStatus,
  Timesheet,
  TimesheetAdjustment,
  TimesheetListResponse,
  TimesheetStatus,
  UpdateTimeEntryInput,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
export {
  ApproveTimesheetSchema,
  ClockInSchema,
  ClockOutSchema,
  CreateRetroactiveTimeEntrySchema,
  QueryTimesheetSchema,
  ReopenTimesheetSchema,
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
  TIMESHEET_STATUSES,
  TimeEntryListResponseSchema,
  TimeEntrySchema,
  TimesheetListResponseSchema,
  TimesheetSchema,
  UpdateTimeEntrySchema,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';

/** URL param validation for /households/:householdId/time-entries and /households/:householdId/timesheets routes. */
export const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});
export type HouseholdIdParam = z.infer<typeof HouseholdIdParamSchema>;

/** URL param validation for /time-entries/:id/clock-out. */
export const TimeEntryIdParamSchema = z.object({
  id: z.uuid(),
});
export type TimeEntryIdParam = z.infer<typeof TimeEntryIdParamSchema>;

/** URL param validation for /timesheets/:id/approve, /query, and /reopen. */
export const TimesheetIdParamSchema = z.object({
  id: z.uuid(),
});
export type TimesheetIdParam = z.infer<typeof TimesheetIdParamSchema>;

/**
 * Query validation for GET /households/:householdId/timesheets?carer_id=.
 *
 * Optional, deliberately: omitting it keeps the every-carer behaviour these
 * endpoints have always had. Supplying it narrows to ONE carer, which any
 * caller adding the results up MUST do — in a two-carer household the
 * unscoped list mixes both nannies' hours into one figure (F-B1-3), and a
 * timesheet is identified by `(household_id, carer_id, week_start)`, never by
 * the week alone.
 *
 * Not `.strict()`: zod strips unknown keys by default, so adding validation
 * to a route that previously validated no query at all cannot start 400ing a
 * request that used to succeed.
 */
export const CarerQuerySchema = z.object({
  carer_id: z.uuid().optional(),
});
export type CarerQuery = z.infer<typeof CarerQuerySchema>;

/**
 * Query validation for GET /households/:householdId/time-entries?week_start=.
 * `week_start` is optional: omitting it means "the current week" (resolved
 * server-side in the household's timezone — see `utils/weekStart.ts`).
 * Extends the carer filter above, so both household-nested reads narrow the
 * same way with the same param name.
 */
export const WeekQuerySchema = CarerQuerySchema.extend({
  week_start: z.iso.date().optional(),
});
export type WeekQuery = z.infer<typeof WeekQuerySchema>;
