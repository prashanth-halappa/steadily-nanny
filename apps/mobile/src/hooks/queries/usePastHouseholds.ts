import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Households the signed-in user was REMOVED from. Deliberately its own query
 * rather than a second field on `useHouseholds`: nothing that gates a write
 * or resolves a role may ever see one of these, and a separate key makes
 * that hard to get wrong by accident.
 *
 * A failure here must NOT be surfaced as an app-level error — see
 * `useActiveHousehold`, which folds the result in but not the error state.
 */
export function usePastHouseholds() {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.household.past(),
    queryFn: householdApi.listPast,
    staleTime: QUERY_TIMING.STALE_5M,
    enabled: !!session && isInitialized,
  });
}
