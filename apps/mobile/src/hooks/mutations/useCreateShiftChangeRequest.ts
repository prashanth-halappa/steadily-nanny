/** @module hooks/mutations/useCreateShiftChangeRequest */

import type { CreateShiftChangeRequestInput } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { changeRequestApi } from '@/src/api/endpoints/changeRequests';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useCreateShiftChangeRequest() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation({
    mutationFn: ({
      shiftId,
      input,
    }: {
      shiftId: string;
      input: CreateShiftChangeRequestInput;
    }) => changeRequestApi.create(shiftId, input),
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.shift.changeRequests(vars.shiftId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      if (result.status === 'pending_approval') {
        showSuccessToast(t('schedule:change.pendingApprovalToast'));
      } else {
        showSuccessToast(t('schedule:change.requestedToast'));
      }
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
