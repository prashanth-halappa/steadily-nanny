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
 * NOBODY PRESSES ANYTHING (1.7). `MyPayScreen` fires this on first render
 * with data — the same rule `terms_proposals.viewed_at` already uses — because
 * the button it replaces looked exactly like an "I agree" button and then said
 * in fine print that it was not one. No error toast: a failure surfaces inline
 * on the card, and the card is honest either way (the state word simply still
 * reads "Not read yet").
 *
 * The row the server just wrote is written into the cache BEFORE the
 * invalidate, and that is now load-bearing for a second reason: it is what
 * stops the caller re-firing on the next render while the refetch is in
 * flight.
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
