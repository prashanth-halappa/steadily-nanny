/** @module hooks/queries/useHouseholdClosures — a household's declared closures. Member-visible. */
import { useQuery } from '@tanstack/react-query';
import { householdClosureApi } from '@/src/api/endpoints/householdClosures';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdClosures(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.householdClosures.list(householdId ?? undefined),
    queryFn: () => householdClosureApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
