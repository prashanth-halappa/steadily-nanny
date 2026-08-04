/**
 * @module hooks/mutations/useSendSchedulePattern
 * draft -> pending. Fails server-side (409 PATTERN_MISSING_CARER) if no
 * carer has been picked yet.
 *
 * `patternId` travels as part of the mutate ARGUMENT, not a hook parameter
 * — see `useReplaceSchedulePatternDays`'s header comment for why a hook
 * parameter is the wrong shape when the id can be freshly created earlier
 * in the same handler pass.
 */
import type { ClashWarning } from '@steadily-nanny/shared-types/schemas/me.schema';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { showClashWarningToasts } from '@/src/lib/clashWarningToast';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export interface SendSchedulePatternVariables {
  patternId: string;
}

export type SendSchedulePatternResult = {
  schedule_pattern: SchedulePattern;
  warnings: ClashWarning[];
};

export function useSendSchedulePattern() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation<
    SendSchedulePatternResult,
    Error,
    SendSchedulePatternVariables
  >({
    mutationFn: ({ patternId }) => schedulePatternApi.send(patternId),
    onSuccess: data => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.detail(data.schedule_pattern.id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.all,
      });
      showClashWarningToasts(data.warnings, t);
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
