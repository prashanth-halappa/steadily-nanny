/** @module hooks/mutations/useSendRunningLate — carer one-tap running-late signal. */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useSendRunningLate() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<ShiftEvent, Error, { shiftId: string }>({
    mutationFn: ({ shiftId }) => shiftApi.sendRunningLate(shiftId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
