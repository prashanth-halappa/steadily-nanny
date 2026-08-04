/** @module hooks/mutations/useCreateExtraShift */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  type CreateExtraShiftInput,
  changeRequestApi,
} from '@/src/api/endpoints/changeRequests';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useCreateExtraShift(householdId: string | null | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation({
    mutationFn: (input: CreateExtraShiftInput) => {
      if (!householdId) throw new Error('Missing household');
      return changeRequestApi.createExtra(householdId, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      showSuccessToast(t('schedule:shifts.extraCreatedToast'));
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
