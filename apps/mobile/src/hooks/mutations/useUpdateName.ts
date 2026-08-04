import type { UserProfile } from '@steadily-nanny/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UpdateNameInput } from '@/src/api/endpoints/user';
import { userApi } from '@/src/api/endpoints/user';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Persists the user's own display name (`user_profiles.name`).
 *
 * Distinct from `useUpdateHousehold`, which renames the shared household —
 * this is the caller's personal name, the one other members see next to
 * shifts and handoff notes.
 */
export function useUpdateName() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<UserProfile, Error, UpdateNameInput>({
    mutationFn: input => userApi.updateName(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
