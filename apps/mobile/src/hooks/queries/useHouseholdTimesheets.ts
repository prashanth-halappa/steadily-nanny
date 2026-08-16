/**
 * @module hooks/queries/useHouseholdTimesheets
 *
 * One household's whole timesheet list — lifted from PaymentsScreen so the
 * first-week-approved moment can share the same query key, staleTime, and
 * enabled guard.
 */
import { useQuery } from '@tanstack/react-query';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';

export function useHouseholdTimesheets(householdId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.timesheet.list(householdId ?? undefined),
    queryFn: () => timesheetApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!householdId,
  });
}
