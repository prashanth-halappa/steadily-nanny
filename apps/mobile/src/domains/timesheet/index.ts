/**
 * @module domains/timesheet
 * Barrel — the domain's only public surface. Exports the Hours screen for
 * the route file, plus the pure formatting utils other domains (the Today
 * clock-in card) need — always import those via this barrel, never by
 * reaching into `utils/duration` or `utils/week` directly.
 */
export { HoursScreen } from './components/HoursScreen';
export type {
  ClockInInput,
  ClockOutInput,
  QueryTimesheetInput,
  TimeEntry,
  TimeEntryKind,
  TimeEntryStatus,
  Timesheet,
  TimesheetStatus,
} from './types';
export {
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
  TIMESHEET_STATUSES,
} from './types';
export {
  formatClockTime,
  formatDuration,
  formatElapsedSince,
  formatOvertimeDelta,
} from './utils/duration';
export {
  computeEntryMinutes,
  computeWorkedMinutesFromInstants,
  sumEntryMinutes,
} from './utils/entryMinutes';
export {
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
} from './utils/week';
