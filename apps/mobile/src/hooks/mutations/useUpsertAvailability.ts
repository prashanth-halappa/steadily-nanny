import type {
  CarerAvailability,
  CreateCarerAvailabilityInput,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { availabilityApi } from '@/src/api/endpoints/availability';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Upsert one weekday's availability row. Callers should send the FULL row
 * (weekday + is_available + times + evening_mode), not just the field that
 * changed — `PUT /v1/availability/me` is a full-replace upsert for that
 * weekday, see `src/api/endpoints/availability.ts`.
 */
export function useUpsertAvailability() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<CarerAvailability, Error, CreateCarerAvailabilityInput>({
    mutationFn: input => availabilityApi.upsertWeekday(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.availability.all,
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
