/** @module hooks/queries/useTimeOff — the signed-in carer's own time-off requests. */
import { useQuery } from '@tanstack/react-query';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * All of the caller's own time-off rows — requested/confirmed/cancelled
 * alike, most-recent first as the API returns them. No household or date
 * argument: `carer_time_off` is scoped to the carer, not any one household.
 */
export function useTimeOff() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.timeOff.list(),
    queryFn: timeOffApi.list,
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized,
  });
}
