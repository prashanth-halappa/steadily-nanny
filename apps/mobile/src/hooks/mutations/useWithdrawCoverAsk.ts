/** @module hooks/mutations/useWithdrawCoverAsk — parent retracts an unanswered cover ask. */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';

export function useWithdrawCoverAsk() {
  const queryClient = useQueryClient();

  return useMutation<Shift, Error, string>({
    mutationFn: shiftId => shiftApi.withdrawCoverAsk(shiftId),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.shift.detail(data.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
    },
    onSettled: () => {
      requestCalendarSync();
    },
  });
}
