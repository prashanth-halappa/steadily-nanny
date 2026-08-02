/**
 * @module hooks/mutations/useReplaceSchedulePatternDays
 * Replace a draft pattern's days (and their per-day children) WHOLESALE —
 * the build screen always sends the full set for every selected day, never a
 * partial patch.
 *
 * `patternId` travels as part of the mutate ARGUMENT, not a hook parameter —
 * a hook parameter is captured at render time, so a pattern id created
 * moments earlier in the same handler (via `useCreateSchedulePattern`)
 * would still read as `undefined` here until the next render, sending
 * `PUT /schedule-patterns/undefined/days`. Passing it through `mutate()`
 * lets the caller thread a freshly-resolved id in the same call stack — see
 * `sendScheduleWeek` in `src/domains/schedule/utils.ts`, which is the
 * intended caller for exactly this reason.
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

export type ReplaceSchedulePatternDaysVariables =
  ReplaceSchedulePatternDaysInput & {
    patternId: string;
  };

export function useReplaceSchedulePatternDays() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<
    SchedulePatternWithDays,
    Error,
    ReplaceSchedulePatternDaysVariables
  >({
    mutationFn: ({ patternId, ...input }) =>
      schedulePatternApi.replaceDays(patternId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.detail(variables.patternId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
