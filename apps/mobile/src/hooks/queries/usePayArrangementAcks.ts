/** @module hooks/queries/usePayArrangementAcks — the ack/dissent rows for ONE arrangement version (D-31/D-45). */
import { useQuery } from '@tanstack/react-query';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * Both roles read this: the parent for §8.4's header pill, the carer for her
 * own state word (§8.3). Scoped to one `arrangementId` — an ack belongs to a
 * VERSION of the terms, never to the (household, carer) pair, so a new
 * version legitimately starts with an empty list.
 */
export function usePayArrangementAcks(
  householdId: string | null | undefined,
  carerId: string | null | undefined,
  arrangementId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.pay.acks(
      householdId ?? undefined,
      carerId ?? undefined,
      arrangementId ?? undefined
    ),
    queryFn: () =>
      payArrangementApi.listAcks(
        householdId as string,
        carerId as string,
        arrangementId as string
      ),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      isValidId(carerId) &&
      isValidId(arrangementId),
  });
}
