/**
 * @module hooks/mutations/useRevokeInvite
 *
 * Revokes a pending invite (`PATCH .../invites/:inviteId`,
 * `status: 'revoked'`). Owner/parent only — enforced server-side.
 *
 * Invalidates the household's invite list on success. That list is what the
 * Invites screen renders, and a stopped code that still reads "Waiting" is
 * the one thing this screen must never show. Callers that hold a single
 * invite in `useCreateInvite`'s mutation state (InviteScreen,
 * ManageInviteScreen) still clear it themselves — that copy is not in any
 * cache to invalidate.
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useRevokeInvite(householdId: string) {
  const { t } = useTranslation('errors');
  const queryClient = useQueryClient();

  return useMutation<HouseholdInvite, Error, string>({
    mutationFn: inviteId =>
      householdApi.updateInvite(householdId, inviteId, {
        status: 'revoked',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.household.invites(householdId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
