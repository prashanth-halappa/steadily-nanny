/** @module hooks/mutations/useRespondToShiftChangeRequest */
import type { RespondToShiftChangeRequestInput } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { changeRequestApi } from '@/src/api/endpoints/changeRequests';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast, showSuccessToast } from '@/src/lib/toast';

export function useRespondToShiftChangeRequest() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation({
    mutationFn: ({
      changeRequestId,
      input,
    }: {
      changeRequestId: string;
      input: RespondToShiftChangeRequestInput;
    }) => changeRequestApi.respond(changeRequestId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showSuccessToast(t('schedule:change.respondedToast'));
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
