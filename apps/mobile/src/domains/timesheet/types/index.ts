/**
 * @module domains/timesheet/types
 *
 * Domain-facing re-export of the wire types. The actual shapes live next to
 * their Zod schemas in `src/api/endpoints/timeEntries.ts` and
 * `timesheets.ts` (LOCAL MIRRORS of `supabase/migrations/017_time_tracking.sql`
 * pending `@steadily-nanny/shared-types/schemas/timesheet.schema` — see those
 * files' headers). Re-exporting here means once the shared schema lands,
 * only the two endpoint files change; every domain-internal import stays
 * stable.
 */

export type {
  ClockInInput,
  ClockOutInput,
  TimeEntry,
  TimeEntryKind,
  TimeEntryStatus,
} from '@/src/api/endpoints/timeEntries';
export {
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
} from '@/src/api/endpoints/timeEntries';
export type {
  EarningsLine,
  EarningsLineKind,
  HoursOnlyReason,
  QueryTimesheetInput,
  Timesheet,
  TimesheetStatus,
  TimesheetWeek,
  WeekEarnings,
  WeekEarningsOk,
  WeekEarningsStateResult,
} from '@/src/api/endpoints/timesheets';
export {
  EARNINGS_LINE_KINDS,
  EARNINGS_LINE_ORDER,
  EARNINGS_RESULT_STATUSES,
  HOURS_ONLY_REASONS,
  humanizeEarningsLineKind,
  isKnownEarningsLineKind,
  TIMESHEET_STATUSES,
  WEEK_EARNINGS_STATES,
} from '@/src/api/endpoints/timesheets';
