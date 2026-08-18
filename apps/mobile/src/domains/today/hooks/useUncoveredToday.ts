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
import { localDateToWeekday } from '@/src/domains/schedule/utils/shiftGrouping';
import {
  type UncoveredWindowDisplay,
  withCauses,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
import {
  closuresForLocalDate,
  toCoveredShift,
  toNeedWindow,
} from '@/src/domains/schedule/utils/uncoveredWeek';
import { queryState } from '@/src/hooks/queries/queryState';
import { useHouseholdClosures } from '@/src/hooks/queries/useHouseholdClosures';
import { useHouseholdCommitments } from '@/src/hooks/queries/useHouseholdCommitments';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

export type UncoveredTodayState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'setup' }
  | { status: 'noNeedToday'; localDate: string; weekday: number }
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
  /** Clock read at render — windows that have already ended are dropped. */
  nowMs?: number;
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
  const needOnDay = computeUncovered({
    localDate: args.localDate,
    timezone: args.timezone,
    needWindows,
    shifts: [],
    closures: [],
  });
  if (needOnDay.length === 0) {
    return {
      status: 'noNeedToday',
      localDate: args.localDate,
      weekday: localDateToWeekday(args.localDate),
    };
  }
  // A window nobody can still cover is history, not attention: at 8pm the
  // card was still asking "Ask Andrea to start at 9:00 AM" for a 9-3 gap that
  // closed five hours ago. Every consumer of this hook (the gap card, Today's
  // attention arbitration) inherits the filter from here.
  const nowMs = args.nowMs ?? Date.now();
  const windows = withCauses(
    computeUncovered({
      localDate: args.localDate,
      timezone: args.timezone,
      needWindows,
      shifts: args.shifts.map(toCoveredShift),
      closures: dayClosures,
    }),
    args.shifts
  ).filter(window => Date.parse(window.endsAt) > nowMs);
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

  // `isLoading` stays hand-rolled: the three queries are disabled while
  // there is no household, and a disabled query is `isPending` for good
  // (queryState.ts's PITFALL). The error/retry half is `queryState`'s —
  // a disabled query is never `isError`, so it is safe to read straight.
  const isLoading =
    !localDate ||
    shiftsQuery.isLoading ||
    commitmentsQuery.isLoading ||
    closuresQuery.isLoading;
  const reads = queryState(shiftsQuery, commitmentsQuery, closuresQuery);

  const settled = useMemo((): Exclude<
    UncoveredTodayState,
    { status: 'error' }
  > => {
    if (!localDate || !timeZone || isLoading) {
      return { status: 'loading' };
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
    commitmentsQuery.data,
    shiftsQuery.data,
    closuresQuery.data,
  ]);

  // ERROR WINS OVER LOADING, and outside the memo so the rrule expansion
  // above keeps its data-only deps rather than recomputing on every render
  // for the sake of a fresh `retry` closure.
  if (reads.status === 'error') {
    return { status: 'error', retry: reads.retry };
  }
  return settled;
}
