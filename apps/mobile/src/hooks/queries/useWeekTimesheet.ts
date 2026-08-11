/** @module hooks/queries/useWeekTimesheet — one week's approval roll-ups for a household. */
import { useQuery } from '@tanstack/react-query';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * EVERY carer's timesheet for one household + week (`weekStart` is that
 * household's own first day of the week, not a Monday by assumption),
 * each with its earnings attached — empty when no row exists yet (nothing
 * has been clocked out for that week).
 *
 * A list, not one row (F-B1-3): a timesheet is identified by
 * `(household_id, carer_id, week_start)`, so callers select their own
 * carer's row. That is also what keeps this key honest — it names a
 * household week and holds exactly that, so no carer can be served
 * another's cached row.
 */
export function useWeekTimesheet(
  householdId: string | null | undefined,
  weekStart: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.timesheet.week(
      householdId ?? undefined,
      weekStart ?? undefined
    ),
    queryFn: () =>
      timesheetApi.getWeek(householdId as string, weekStart as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session && isInitialized && isValidId(householdId) && !!weekStart,
  });
}
