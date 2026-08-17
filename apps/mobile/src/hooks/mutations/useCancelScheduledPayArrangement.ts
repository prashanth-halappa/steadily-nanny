/** @module hooks/mutations/useCancelScheduledPayArrangement — D-16/§6, call off a change that has not started. Parents only. */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';

/**
 * Cancelling is an APPEND (the server writes a revert row), not a delete —
 * so it invalidates exactly what an acceptance does: current,
 * history, and the week totals a future rate could have changed.
 *
 * No error toast: the refusal case that matters ("the date already arrived")
 * belongs next to the card it refers to, not floating over the screen.
 */
export function useCancelScheduledPayArrangement(
  householdId: string,
  carerId: string
) {
  const queryClient = useQueryClient();

  return useMutation<PayArrangement, Error, string>({
    mutationFn: arrangementId =>
      payArrangementApi.cancelScheduled(householdId, carerId, arrangementId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.current(householdId, carerId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.history(householdId, carerId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
  });
}
