/**
 * @module hooks/mutations/useWithdrawChangeRequest
 *
 * Requester-only withdraw of a still-pending shift change request — the fix
 * for the shift-detail defect where accept/decline rendered even for the
 * requester's OWN pending request (the inbox already filters this correctly
 * via `requested_by !== me`; this is the schedule-side surface). Mirrors
 * `useWithdrawExpense`'s shape.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { changeRequestApi } from '@/src/api/endpoints/changeRequests';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useWithdrawChangeRequest() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'today']);

  return useMutation({
    mutationFn: (changeRequestId: string) =>
      changeRequestApi.withdraw(changeRequestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showSuccessToast(t('today:shiftDetail.withdrawnToast'));
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
