/** @module hooks/queries/useHouseholdClosures — a household's declared closures. Member-visible. */
import { useQuery } from '@tanstack/react-query';
import { householdClosureApi } from '@/src/api/endpoints/householdClosures';
import { queryKeys } from '@/src/api/queryKeys';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHouseholdClosures(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const { canWrite } = useCanWriteHousehold(householdId);

  return useQuery({
    queryKey: queryKeys.householdClosures.list(householdId ?? undefined),
    queryFn: () => householdClosureApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    // Household-scoped reads 404 for a removed member (the server refuses
    // them by design, while it keeps payroll readable). Asking anyway turns
    // that refusal into a re-ask loop that trips the rate limiter, so we stop
    // asking once membership resolves to `removed` — and we wait, rather than
    // guess, while it is still unknown.
    enabled: !!session && isInitialized && isValidId(householdId) && canWrite,
  });
}
