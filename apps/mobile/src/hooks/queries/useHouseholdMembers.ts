/**
 * @module hooks/queries/useHouseholdMembers
 *
 * Active membership rows for one household — used to resolve display names
 * for user ids on shift change requests and similar agreement surfaces.
 */
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdMembers(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.household.members(householdId ?? undefined),
    queryFn: () => householdApi.listMembers(householdId as string),
    staleTime: QUERY_TIMING.STALE_5M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
