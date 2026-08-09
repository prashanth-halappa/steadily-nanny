/** @module hooks/mutations/useRemoveParentCover — undo parent self-cover. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useRemoveParentCover() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation<void, Error, { shiftId: string }>({
    mutationFn: ({ shiftId }) => shiftApi.removeParentCover(shiftId),
    onSuccess: (_data, { shiftId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.shift.detail(shiftId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showSuccessToast(t('schedule:cover.undoneToast'));
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
