/**
 * @module hooks/mutations/useUpdateNotificationPrefs
 * PATCH /notifications/prefs — opt-outs + quiet hours.
 */
import type { NotificationPrefs } from '@steadily-nanny/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UpdateNotificationPrefsInput } from '@/src/api/endpoints/notifications';
import { notificationsApi } from '@/src/api/endpoints/notifications';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Persists a partial notification-prefs update and refreshes the prefs cache. */
export function useUpdateNotificationPrefs() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<NotificationPrefs, Error, UpdateNotificationPrefsInput>({
    mutationFn: input => notificationsApi.updatePrefs(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.prefs(),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
