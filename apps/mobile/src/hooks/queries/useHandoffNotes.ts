/** @module hooks/queries/useHandoffNotes — handoff notes for one household day. */
import { useQuery } from '@tanstack/react-query';
import { handoffApi } from '@/src/api/endpoints/handoff';
import { queryKeys } from '@/src/api/queryKeys';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useHandoffNotes(
  householdId: string | null | undefined,
  localDate: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const { canWrite } = useCanWriteHousehold(householdId);

  return useQuery({
    queryKey: queryKeys.handoff.list(
      householdId ?? undefined,
      localDate ?? undefined
    ),
    queryFn: () => handoffApi.list(householdId as string, localDate as string),
    staleTime: QUERY_TIMING.STALE_1M,
    // Household-scoped reads 404 for a removed member (the server refuses
    // them by design, while it keeps payroll readable). Asking anyway turns
    // that refusal into a re-ask loop that trips the rate limiter, so we stop
    // asking once membership resolves to `removed` — and we wait, rather than
    // guess, while it is still unknown.
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      !!localDate &&
      localDate.length > 0 &&
      canWrite,
  });
}
