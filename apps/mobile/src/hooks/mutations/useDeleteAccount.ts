/**
 * @module hooks/mutations/useDeleteAccount
 *
 * Permanently deletes the authenticated user's account. Wraps
 * `userApi.deleteAccount()` (DELETE /v1/users/me) — the mutation itself does
 * not sign out or navigate; the caller (the settings delete-account row)
 * owns that sequencing after a successful delete.
 */

import type { UserDeleteAccountResponse } from '@steadily-nanny/shared-types';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { userApi } from '@/src/api/endpoints/user';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Permanently delete the authenticated user's account. */
export function useDeleteAccount() {
  const { t } = useTranslation('errors');

  return useMutation<UserDeleteAccountResponse, Error, void>({
    mutationFn: () => userApi.deleteAccount(),
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
