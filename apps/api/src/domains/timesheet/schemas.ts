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
  TimesheetListResponse,
  TimesheetStatus,
  UpdateTimeEntryInput,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
export {
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
 * Query validation for GET /households/:householdId/time-entries?week_start=.
 * Optional: omitting it means "the current week" (resolved server-side in
 * the household's timezone — see `utils/weekStart.ts`).
 */
export const WeekQuerySchema = z.object({
  week_start: z.iso.date().optional(),
});
export type WeekQuery = z.infer<typeof WeekQuerySchema>;
