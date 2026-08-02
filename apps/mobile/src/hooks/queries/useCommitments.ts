/** @module hooks/queries/useCommitments — list commitments for one child. */
import { useQuery } from '@tanstack/react-query';
import { commitmentApi } from '@/src/api/endpoints/commitments';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useCommitments(
  householdId: string | null | undefined,
  childId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.commitments.list(
      householdId ?? undefined,
      childId ?? undefined
    ),
    queryFn: () => commitmentApi.list(householdId as string, childId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      isValidId(childId),
  });
}
