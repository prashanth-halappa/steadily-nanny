/**
 * @module domains/today/hooks/useUncoveredToday
 *
 * Live uncovered-care for today — shifts + commitments + closures through
 * `computeUncovered`. Replaces the day-thread `useTodayCoverageGaps` hook so
 * fixing the schedule clears the card without waiting on append-only events.
 */

import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { computeUncovered } from '@steadily-nanny/shared-types/uncoveredCare';
import { useMemo } from 'react';
import {
  type UncoveredWindowDisplay,
  withCauses,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
import {
  closuresForLocalDate,
  toCoveredShift,
  toNeedWindow,
} from '@/src/domains/schedule/utils/uncoveredWeek';
import { useHouseholdClosures } from '@/src/hooks/queries/useHouseholdClosures';
import { useHouseholdCommitments } from '@/src/hooks/queries/useHouseholdCommitments';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

export type UncoveredTodayState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'setup' }
  | { status: 'covered'; localDate: string }
  | {
      status: 'uncovered';
      localDate: string;
      windows: UncoveredWindowDisplay[];
    };

export function computeUncoveredToday(args: {
  localDate: string;
  timezone: string;
  commitments: readonly ChildCommitment[];
  shifts: readonly Shift[];
  closures: readonly HouseholdClosure[];
}): Exclude<UncoveredTodayState, { status: 'loading' | 'error' }> {
  if (args.commitments.length === 0) {
    return { status: 'setup' };
  }
  const needWindows = args.commitments.map(toNeedWindow);
  const dayClosures = closuresForLocalDate(
    args.closures,
    args.localDate,
    args.timezone
  );
  const windows = withCauses(
    computeUncovered({
      localDate: args.localDate,
      timezone: args.timezone,
      needWindows,
      shifts: args.shifts.map(toCoveredShift),
      closures: dayClosures,
    }),
    args.shifts
  );
  if (windows.length === 0) {
    return { status: 'covered', localDate: args.localDate };
  }
  return { status: 'uncovered', localDate: args.localDate, windows };
}

export function useUncoveredToday(
  householdId: string | null | undefined,
  timeZone: string | null | undefined
): UncoveredTodayState {
  const localDate = timeZone ? localDateInZone(timeZone) : null;
  const from =
    localDate && timeZone
      ? wallClockToUtcIso(localDate, '00:00', timeZone)
      : '';
  const to =
    localDate && timeZone
      ? wallClockToUtcIso(addLocalDays(localDate, 1), '00:00', timeZone)
      : '';

  const shiftsQuery = useShiftsRange(householdId, from, to);
  const commitmentsQuery = useHouseholdCommitments(householdId);
  const closuresQuery = useHouseholdClosures(householdId);

  const isLoading =
    !localDate ||
    shiftsQuery.isLoading ||
    commitmentsQuery.isLoading ||
    closuresQuery.isLoading;
  const isError =
    shiftsQuery.isError || commitmentsQuery.isError || closuresQuery.isError;

  return useMemo(() => {
    if (!localDate || !timeZone) {
      return { status: 'loading' };
    }
    if (isLoading) {
      return { status: 'loading' };
    }
    if (isError) {
      return { status: 'error' };
    }
    return computeUncoveredToday({
      localDate,
      timezone: timeZone,
      commitments: commitmentsQuery.data ?? [],
      shifts: shiftsQuery.data ?? [],
      closures: closuresQuery.data ?? [],
    });
  }, [
    localDate,
    timeZone,
    isLoading,
    isError,
    commitmentsQuery.data,
    shiftsQuery.data,
    closuresQuery.data,
  ]);
}
