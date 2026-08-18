/**
 * @module app/(private)/schedule/usual-week
 *
 * Pushed from the Schedule tab's pattern banner ("See it" / "See why") —
 * NOT a tab root. The calendar (`ScheduleShiftsScreen`) is the Schedule
 * tab's root now; this is the usual-week detail screen, one level deep.
 *
 * S11: forks by role. Parent/helper get `SchedulePendingScreen` (resolves
 * its household from `useActiveHousehold` — a parent has exactly one). A
 * nanny gets `NannyUsualWeekScreen` instead — read-only, and it resolves
 * its household from the `householdId` query param
 * (`useHouseholdById`/Pattern A), since she can work for more than one and
 * this route is also the `SCHEDULE_PATTERN_WITHDRAWN` push destination.
 */
import {
  NannyUsualWeekScreen,
  SchedulePendingScreen,
} from '@/src/domains/schedule';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';

export default function ScheduleUsualWeekRoute() {
  const onboarding = useIsOnboarded();
  if (onboarding.role === SETUP_ROLES.NANNY) {
    return <NannyUsualWeekScreen />;
  }
  return <SchedulePendingScreen />;
}
