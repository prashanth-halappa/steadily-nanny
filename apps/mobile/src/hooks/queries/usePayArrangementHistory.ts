/** @module hooks/queries/usePayArrangementHistory — the append-only rate history for one carer in one household. */
import { useQuery } from '@tanstack/react-query';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Every pay arrangement ever created for one (household, carer) pair,
 * newest first — the change history a parent (or the carer herself, of her
 * own terms) can review (docs/11-MONEY.md §2/§3, append-only).
 */
export function usePayArrangementHistory(
  householdId: string | null | undefined,
  carerId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.pay.history(
      householdId ?? undefined,
      carerId ?? undefined
    ),
    queryFn: () =>
      payArrangementApi.getHistory(householdId as string, carerId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      isValidId(carerId),
  });
}
