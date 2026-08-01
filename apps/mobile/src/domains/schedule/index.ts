/**
 * @module domains/schedule
 * Public surface of the schedule domain — parent builds a "usual week" and
 * sends it; the nanny accepts or declines; both view the materialised
 * shifts. Route files under `src/app/(private)/schedule/**` import from here
 * rather than reaching into `components/` directly.
 */
export { ScheduleBuildScreen } from './components/ScheduleBuildScreen';
export { SchedulePendingScreen } from './components/SchedulePendingScreen';
export { ScheduleRespondScreen } from './components/ScheduleRespondScreen';
export { ScheduleShiftsScreen } from './components/ScheduleShiftsScreen';
