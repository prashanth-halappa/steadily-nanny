import type {
  UserProfile,
  UserProfileRequest,
} from '@steadily-nanny/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { userApi } from '@/src/api/endpoints/user';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';
import { registerDeviceWithBackend } from '@/src/lib/userDevice';

/**
 * Create/update the user profile. On success, registers this device with the
 * backend.
 *
 * GOLDEN (FK ordering): device registration runs in onSuccess — AFTER the
 * profile row exists — because the device row's FK references the user profile.
 * Registering earlier FK-fails silently and leaves the device (and its timezone)
 * unregistered.
 */
export function useUpsertProfile() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<UserProfile, Error, UserProfileRequest>({
    mutationFn: req => userApi.upsertProfile(req),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
      try {
        await registerDeviceWithBackend();
      } catch (error) {
        if (__DEV__)
          console.warn('[profile] device registration failed', error);
      }
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
