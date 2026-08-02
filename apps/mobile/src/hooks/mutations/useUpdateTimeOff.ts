/** @module hooks/mutations/useUpdateTimeOff — edit dates/message on a time-off row the caller owns. */
import type {
  CarerTimeOff,
  UpdateCarerTimeOffInput,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { timeOffApi } from '@/src/api/endpoints/timeOff';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export interface UpdateTimeOffVariables {
  id: string;
  input: UpdateCarerTimeOffInput;
}

interface ErrorWithCode extends Error {
  code?: string;
}

/**
 * PATCHes a time-off row by id. Cancel stays on `useCancelTimeOff` — never
 * send `status` here; the API rejects it.
 */
export function useUpdateTimeOff() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<CarerTimeOff, Error, UpdateTimeOffVariables>({
    mutationFn: ({ id, input }) => timeOffApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.timeOff.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.availability.all });
    },
    onError: error => {
      const errorWithCode = error as ErrorWithCode;
      const contextKey =
        errorWithCode.code === 'CANCEL_VIA_DELETE'
          ? 'errors:cancelViaDelete'
          : undefined;
      showErrorToast(getLocalizedErrorMessage(error, t, contextKey));
    },
  });
}
