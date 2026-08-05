/** @module hooks/queries/useCurrentPayArrangement — the rate + terms effective today for one carer in one household. */
import { useQuery } from '@tanstack/react-query';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The pay arrangement effective today for one (household, carer) pair, or
 * `null` when the carer has no arrangement yet. `null` is a normal,
 * successful result — it renders "Set a pay rate to see totals", never
 * £0.00 (docs/11-MONEY.md §4) — so it is returned as-is, never treated as an
 * error state.
 */
export function useCurrentPayArrangement(
  householdId: string | null | undefined,
  carerId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.pay.current(
      householdId ?? undefined,
      carerId ?? undefined
    ),
    queryFn: () =>
      payArrangementApi.getCurrent(householdId as string, carerId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      isValidId(carerId),
  });
}
