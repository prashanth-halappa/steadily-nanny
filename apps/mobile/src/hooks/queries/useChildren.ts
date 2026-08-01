import { useQuery } from '@tanstack/react-query';
import { childrenApi } from '@/src/api/endpoints/children';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/** A household's (non-archived) children. */
export function useChildren(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.children.list(householdId ?? undefined),
    queryFn: () => childrenApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
