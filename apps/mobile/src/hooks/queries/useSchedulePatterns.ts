/**
 * @module hooks/queries/useSchedulePatterns
 * A household's schedule patterns (draft, pending, accepted, ...).
 */
import { useQuery } from '@tanstack/react-query';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useSchedulePatterns(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const { canWrite } = useCanWriteHousehold(householdId);

  return useQuery({
    queryKey: queryKeys.schedulePattern.list(householdId ?? undefined),
    queryFn: () => schedulePatternApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    // Household-scoped reads 404 for a removed member (the server refuses
    // them by design, while it keeps payroll readable). Asking anyway turns
    // that refusal into a re-ask loop that trips the rate limiter, so we stop
    // asking once membership resolves to `removed` — and we wait, rather than
    // guess, while it is still unknown.
    enabled: !!session && isInitialized && isValidId(householdId) && canWrite,
  });
}
