/**
 * @module hooks/mutations/useWithdrawSchedulePattern
 * pending -> withdrawn. The parent pulls back a proposal the carer hasn't
 * answered yet.
 */
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { schedulePatternApi } from '@/src/api/endpoints/schedulePatterns';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useWithdrawSchedulePattern(patternId: string | undefined) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<SchedulePattern, Error, void>({
    mutationFn: () => schedulePatternApi.withdraw(patternId as string),
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
