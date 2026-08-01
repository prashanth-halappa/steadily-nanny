/** @module hooks/queries/useWeekTimesheet — one week's approval roll-up for a household. */
import { useQuery } from '@tanstack/react-query';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The timesheet for one household + week (Monday `weekStart`), or `null`
 * when no row exists yet (nothing has been clocked out for that week).
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
