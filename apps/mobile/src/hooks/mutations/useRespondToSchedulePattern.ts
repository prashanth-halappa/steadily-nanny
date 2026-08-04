/**
 * @module hooks/mutations/useRespondToSchedulePattern
 * The carer accepts or declines a pending pattern. Accepting materialises
 * shifts server-side, so a successful response also invalidates the shift
 * range cache (best-effort — the specific from/to windows a screen is
 * viewing are invalidated via the shared `shift.all` prefix).
 */
import type { ClashWarning } from '@steadily-nanny/shared-types/schemas/me.schema';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RespondToSchedulePatternInput } from '@/src/api/endpoints/schedulePatterns';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { showClashWarningToasts } from '@/src/lib/clashWarningToast';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export type RespondToSchedulePatternResult = {
  schedule_pattern: SchedulePattern;
  warnings: ClashWarning[];
};

export function useRespondToSchedulePattern(patternId: string | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation<
    RespondToSchedulePatternResult,
    Error,
    RespondToSchedulePatternInput
  >({
    mutationFn: input => schedulePatternApi.respond(patternId as string, input),
    onSuccess: data => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.detail(patternId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
      showClashWarningToasts(data.warnings, t);
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
