/** @module hooks/queries/useHouseholdCommitments — list all commitments in a household. */
import { useQuery } from '@tanstack/react-query';
import { commitmentApi } from '@/src/api/endpoints/commitments';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdCommitments(
  householdId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.commitments.byHousehold(householdId ?? undefined),
    queryFn: () => commitmentApi.listForHousehold(householdId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
