/**
 * @module hooks/mutations/useRevokeInvite
 *
 * Revokes a pending invite (`PATCH .../invites/:inviteId`,
 * `status: 'revoked'`). Owner/parent only — enforced server-side.
 *
 * No list-invites endpoint exists yet, so there is no query to invalidate —
 * the caller (InviteCodeCard's wiring in InviteScreen/ManageInviteScreen)
 * clears the invite it's holding in `useCreateInvite`'s mutation state on
 * success.
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

export function useRevokeInvite(householdId: string) {
  const { t } = useTranslation('errors');

  return useMutation<HouseholdInvite, Error, string>({
    mutationFn: inviteId =>
      householdApi.updateInvite(householdId, inviteId, {
        status: 'revoked',
      }),
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
