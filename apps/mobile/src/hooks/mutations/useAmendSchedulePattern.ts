/**
 * @module hooks/mutations/useAmendSchedulePattern
 *
 * Amend an ACCEPTED pattern's skips / pauses / end date — the server has no
 * post-accept day/time amend, so this can never carry a day/time change
 * (see `AmendSchedulePatternSchema`'s doc comment and
 * `apps/api/src/domains/schedule/services/schedulePatternCommandService.ts`'s
 * `amend`). An amend re-materialises shifts server-side, so a successful
 * amend invalidates the shift range cache too — same shape as
 * `useRespondToSchedulePattern`'s accept branch — and requests a calendar
 * resync on settle, since the re-materialised shifts can move.
 */
import type { ClashWarning } from '@steadily-nanny/shared-types/schemas/me.schema';
import type {
  AmendSchedulePatternInput,
  SchedulePattern,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { showClashWarningToasts } from '@/src/lib/clashWarningToast';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export type AmendSchedulePatternResult = {
  schedule_pattern: SchedulePattern;
  warnings: ClashWarning[];
};

export function useAmendSchedulePattern(patternId: string | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['errors', 'schedule']);

  return useMutation<
    AmendSchedulePatternResult,
    Error,
    AmendSchedulePatternInput
  >({
    mutationFn: input => schedulePatternApi.amend(patternId as string, input),
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
