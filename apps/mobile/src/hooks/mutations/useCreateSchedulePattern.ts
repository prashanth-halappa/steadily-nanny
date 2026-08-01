/**
 * @module hooks/mutations/useCreateSchedulePattern
 * Sketch a new draft pattern for a household (parent-only, enforced
 * server-side). `timezone` is never sent — the server copies it from the
 * household.
 */
import type {
  CreateSchedulePatternInput,
  SchedulePattern,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useCreateSchedulePattern(householdId: string | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<SchedulePattern, Error, CreateSchedulePatternInput>({
    mutationFn: input =>
      schedulePatternApi.create(householdId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.all,
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
