import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/** The signed-in user's own households. */
export function useHouseholds() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.household.list(),
    queryFn: householdApi.list,
    staleTime: QUERY_TIMING.STALE_5M,
    enabled: !!session && isInitialized,
  });
}
