/** @module hooks/mutations/useDissentPayArrangement — D-45 "I don't agree with this". Carer only. */
import type { PayArrangementAck } from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';

export interface DissentPayArrangementInput {
  arrangementId: string;
  /** Her own words, optional, 280 chars — validated by the shared schema. */
  note?: string;
}

/**
 * Records an objection against one version of the terms. It blocks NOTHING
 * (spec §8.3.1): the terms stay in effect and the week keeps pricing, so no
 * arrangement or timesheet cache is touched — only the ack list.
 *
 * No error toast, for the same reason as `useAckPayArrangement`.
 */
export function useDissentPayArrangement(householdId: string, carerId: string) {
  const queryClient = useQueryClient();

  return useMutation<PayArrangementAck, Error, DissentPayArrangementInput>({
    mutationFn: ({ arrangementId, note }) =>
      payArrangementApi.dissent(householdId, carerId, arrangementId, note),
    onSuccess: (_ack, { arrangementId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.acks(householdId, carerId, arrangementId),
      });
    },
  });
}
