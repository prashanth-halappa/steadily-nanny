import type { UserProfile } from '@steadily-nanny/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UpdatePreferredLocaleInput } from '@/src/api/endpoints/user';
import { userApi } from '@/src/api/endpoints/user';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Persists the user's preferred display language server-side (D26).
 *
 * Deliberately separate from `useLanguageStore.setLanguage`, which applies
 * the change locally (MMKV + `i18n.changeLanguage`) instantly and
 * unconditionally — the app must re-render in the new language even if this
 * network call is slow or fails offline. Call both from the same press
 * handler; never make the local change depend on this succeeding.
 */
export function useUpdatePreferredLocale() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<UserProfile, Error, UpdatePreferredLocaleInput>({
    mutationFn: input => userApi.updatePreferredLocale(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
