/** @module hooks/mutations/useDeclineShift — carer pending → declined. */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useDeclineShift() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation<Shift, Error, { shiftId: string }>({
    mutationFn: ({ shiftId }) => shiftApi.decline(shiftId),
    onSuccess: shift => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.shift.detail(shift.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      // Reuses the pattern-decline copy ("Declined.") — same terminal
      // outcome, same word, no new schedule-namespace string needed.
      showSuccessToast(t('schedule:respond.declinedToast'));
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
