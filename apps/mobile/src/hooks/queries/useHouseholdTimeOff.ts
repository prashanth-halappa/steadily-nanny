/**
 * @module hooks/queries/useHouseholdTimeOff
 * Parent-facing list of carers' time off for one household.
 */
import { useQuery } from '@tanstack/react-query';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdTimeOff(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.timeOff.forHousehold(householdId ?? undefined),
    queryFn: () => timeOffApi.listForHousehold(householdId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
