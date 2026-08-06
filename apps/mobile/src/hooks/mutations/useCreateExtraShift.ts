/** @module hooks/mutations/useCreateExtraShift */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  type CreateExtraShiftInput,
  type CreateExtraShiftResult,
  changeRequestApi,
} from '@/src/api/endpoints/changeRequests';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { showClashWarningToasts } from '@/src/lib/clashWarningToast';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useCreateExtraShift(householdId: string | null | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation({
    mutationFn: (
      input: CreateExtraShiftInput
    ): Promise<CreateExtraShiftResult> => {
      if (!householdId) throw new Error('Missing household');
      return changeRequestApi.createExtra(householdId, input);
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      // An adopted result means a double-tap/race found an existing shift
      // rather than making a new one — the shift already got its toast (and
      // its clash warnings) the first time, so re-showing both here would be
      // noise, not news. Caches still get invalidated above either way.
      if (result.status === 'created' && result.adopted) return;
      showSuccessToast(t('schedule:shifts.extraCreatedToast'));
      if (result.status === 'created') {
        showClashWarningToasts(result.warnings, t);
      }
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
