/**
 * @module hooks/mutations/useRespondToSchedulePattern
 * The carer accepts or declines a pending pattern. Accepting materialises
 * shifts server-side, so a successful response also invalidates the shift
 * range cache (best-effort — the specific from/to windows a screen is
 * viewing are invalidated via the shared `shift.all` prefix).
 */
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RespondToSchedulePatternInput } from '@/src/api/endpoints/schedulePatterns';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { requestCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useRespondToSchedulePattern(patternId: string | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<SchedulePattern, Error, RespondToSchedulePatternInput>({
    mutationFn: input => schedulePatternApi.respond(patternId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.detail(patternId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.shift.all });
    },
    onSettled: () => {
      requestCalendarSync();
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
