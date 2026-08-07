/** @module hooks/mutations/useRequestTimeOff — request time off, instantly confirmed (no approval step). */
import type {
  CarerTimeOff,
  CreateCarerTimeOffInput,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Creates a time-off request. There is no approval step anywhere in the
 * API — the row lands as `status: 'confirmed'` on success, not `'pending'`;
 * callers should not show any "awaiting approval" copy.
 *
 * `input.kind` (068, `CARER_TIME_OFF_KINDS`) rides through unchanged — this
 * hook never sets a default, it just forwards whatever `CreateCarerTimeOffInput`
 * the caller built. Omitting `kind` entirely keeps existing personal-request
 * callers byte-for-byte unchanged (the server defaults the column to
 * `'personal'`).
 */
export function useRequestTimeOff() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<CarerTimeOff, Error, CreateCarerTimeOffInput>({
    mutationFn: input => timeOffApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeOff.all });
      // Busy view unions time_off rows — keep clash checks fresh (D30).
      queryClient.invalidateQueries({ queryKey: queryKeys.availability.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
