/**
 * @module domains/today/hooks/useHouseholdIsLive
 *
 * Daylight live-wash predicate: the house warms while *someone* is on the
 * clock — either the caller's own running entry, or any household week entry
 * still `status === 'running'`. Shared by TodayScreen (wash) so the signal
 * isn't split across role-specific cards.
 */
import { useMemo } from 'react';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';

/**
 * True when the caller has a running time entry OR any household week entry
 * is still running. Missing `householdId` / `timeZone` disables the week
 * query and contributes `false` for that half; the caller's own running
 * entry still counts.
 */
export function useHouseholdIsLive(
  householdId: string | null | undefined,
  timeZone: string | null | undefined
): boolean {
  const running = useRunningTimeEntry();
  const weekStart = useMemo(
    () => (timeZone ? getWeekStartISO(new Date(), timeZone) : null),
    [timeZone]
  );
  const entries = useWeekTimeEntries(householdId, weekStart);
  const householdHasRunning = (entries.data ?? []).some(
    e => e.status === 'running'
  );

  return !!running.data || householdHasRunning;
}
