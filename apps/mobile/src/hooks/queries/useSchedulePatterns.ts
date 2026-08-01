/**
 * @module hooks/queries/useSchedulePatterns
 * A household's schedule patterns (draft, pending, accepted, ...).
 */
import { useQuery } from '@tanstack/react-query';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useSchedulePatterns(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.schedulePattern.list(householdId ?? undefined),
    queryFn: () => schedulePatternApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
