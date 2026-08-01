/**
 * @module hooks/mutations/useReplaceSchedulePatternDays
 * Replace a draft pattern's days (and their per-day children) WHOLESALE —
 * the build screen always sends the full set for every selected day, never a
 * partial patch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  ReplaceSchedulePatternDaysInput,
  SchedulePatternWithDays,
} from '@/src/api/endpoints/schedulePatterns';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useReplaceSchedulePatternDays(patternId: string | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<
    SchedulePatternWithDays,
    Error,
    ReplaceSchedulePatternDaysInput
  >({
    mutationFn: input =>
      schedulePatternApi.replaceDays(patternId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.detail(patternId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
