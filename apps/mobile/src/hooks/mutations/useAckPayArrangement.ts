/** @module hooks/mutations/useAckPayArrangement — D-31 "I've seen these terms". Carer only. */
import type { PayArrangementAck } from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';

/**
 * Records that the carer SAW one version of her terms. It is a receipt, not
 * consent (D-41) — nothing about the arrangement itself changes, so only the
 * ack list is invalidated.
 *
 * No error toast: a failure surfaces inline on the card next to the button
 * that failed, where the person who pressed it is already looking.
 *
 * The row the server just wrote is written into the cache BEFORE the
 * invalidate: the prompt she pressed must go away on the press, not one
 * round-trip later, and a refetch that then fails must not put it back —
 * the write has already happened, and showing the button again reads as the
 * app having lost her tap.
 */
export function useAckPayArrangement(householdId: string, carerId: string) {
  const queryClient = useQueryClient();

  return useMutation<PayArrangementAck, Error, string>({
    mutationFn: arrangementId =>
      payArrangementApi.ack(householdId, carerId, arrangementId),
    onSuccess: (ack, arrangementId) => {
      const key = queryKeys.pay.acks(householdId, carerId, arrangementId);
      queryClient.setQueryData<PayArrangementAck[]>(key, rows =>
        rows ? [...rows, ack] : [ack]
      );
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
