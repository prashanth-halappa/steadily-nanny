/** @module hooks/mutations/useUpdateTimeSettings — D29 display timezone / week start. */
import type { UserProfile } from '@steadily-nanny/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UpdateTimeSettingsInput } from '@/src/api/endpoints/user';
import { userApi } from '@/src/api/endpoints/user';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Persists the caller's display timezone and/or week-start preference.
 * Presentation lens only: this is `user_profiles.week_starts_on`, which
 * rotates calendar column order for THIS user. It never moves a week
 * boundary — timesheets and Hours are anchored on the HOUSEHOLD's
 * `households.week_starts_on` (domains/timesheet/utils/week.ts), a
 * different column answering a different question.
 */
export function useUpdateTimeSettings() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<UserProfile, Error, UpdateTimeSettingsInput>({
    mutationFn: input => userApi.updateTimeSettings(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
