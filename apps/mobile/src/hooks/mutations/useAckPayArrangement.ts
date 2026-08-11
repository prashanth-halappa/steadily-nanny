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
 */
export function useAckPayArrangement(householdId: string, carerId: string) {
  const queryClient = useQueryClient();

  return useMutation<PayArrangementAck, Error, string>({
    mutationFn: arrangementId =>
      payArrangementApi.ack(householdId, carerId, arrangementId),
    onSuccess: (_ack, arrangementId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.acks(householdId, carerId, arrangementId),
      });
    },
  });
}
