/**
 * @module hooks/queries/useSchedulePattern
 * One schedule pattern, with its days and per-day children — the shape the
 * build/review and respond screens render from.
 */
import { useQuery } from '@tanstack/react-query';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useSchedulePattern(patternId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.schedulePattern.detail(patternId ?? undefined),
    queryFn: () => schedulePatternApi.getById(patternId as string),
    staleTime: QUERY_TIMING.STALE_30S,
    enabled: !!session && isInitialized && isValidId(patternId),
  });
}
