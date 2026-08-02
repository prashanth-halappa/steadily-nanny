/** @module hooks/mutations/useCancelTimeOff — soft-cancel a time-off request the caller owns. */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Cancels a time-off request by id. `DELETE /v1/time-off/:id` is a SOFT
 * cancel (status -> 'cancelled') — the row persists, it is never removed
 * from the list.
 */
export function useCancelTimeOff() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<CarerTimeOff, Error, string>({
    mutationFn: timeOffId => timeOffApi.cancel(timeOffId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeOff.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
