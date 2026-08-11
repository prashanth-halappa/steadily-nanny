/**
 * Timesheet domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { TimeEntry } from '../types'` following the domain-anatomy
 * convention.
 *
 * @module domains/timesheet/types
 */
export type {
  AddTimesheetThreadMessageInput,
  ApproveTimesheetInput,
  CarerQuery,
  ClockInInput,
  ClockOutInput,
  CreateRetroactiveTimeEntryInput,
  HouseholdIdParam,
  QueryTimesheetInput,
  ReopenTimesheetInput,
  TimeEntry,
  TimeEntryIdParam,
  TimeEntryKind,
  TimeEntryListResponse,
  TimeEntryStatus,
  Timesheet,
  TimesheetAdjustment,
  TimesheetIdParam,
  TimesheetListResponse,
  TimesheetStatus,
  TimesheetThread,
  TimesheetThreadMessage,
  UpdateTimeEntryInput,
  WeekQuery,
} from '../schemas';
