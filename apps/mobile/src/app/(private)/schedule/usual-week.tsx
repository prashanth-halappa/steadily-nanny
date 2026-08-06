/**
 * @module app/(private)/schedule/usual-week
 *
 * Pushed from the Schedule tab's pattern banner ("See it" / "See why") —
 * NOT a tab root. The calendar (`ScheduleShiftsScreen`) is the Schedule
 * tab's root now; this is the usual-week detail screen, one level deep.
 */
import { SchedulePendingScreen } from '@/src/domains/schedule';

export default function ScheduleUsualWeekRoute() {
  return <SchedulePendingScreen />;
}
