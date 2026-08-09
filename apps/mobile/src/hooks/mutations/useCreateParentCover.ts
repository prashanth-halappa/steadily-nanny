/** @module hooks/mutations/useCreateParentCover — parent self-cover ("I've got it"). */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useCreateParentCover() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation<
    Shift,
    Error,
    {
      householdId: string;
      starts_at: string;
      ends_at: string;
      child_id: string;
    }
  >({
    mutationFn: ({ householdId, ...input }) =>
      shiftApi.createParentCover(householdId, input),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.shift.detail(data.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showSuccessToast(t('schedule:cover.coveringToast'));
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
