/**
 * @module hooks/mutations/useUpdateSchedulePattern
 * Edit a draft pattern's top-level fields (rrule/dtstart/until/note/...).
 * Draft-only — the server returns 409 PATTERN_NOT_EDITABLE once it's sent.
 */
import type {
  SchedulePattern,
  UpdateSchedulePatternInput,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useUpdateSchedulePattern(patternId: string | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<SchedulePattern, Error, UpdateSchedulePatternInput>({
    mutationFn: input => schedulePatternApi.update(patternId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.detail(patternId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedulePattern.all,
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
