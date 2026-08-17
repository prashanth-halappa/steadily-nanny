import type {
  CreateHouseholdInviteInput,
  HouseholdInvite,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Generates an invite code for a household (parents only, enforced server-side). */
export function useCreateInvite(householdId: string) {
  const { t } = useTranslation('errors');
  const queryClient = useQueryClient();

  return useMutation<HouseholdInvite, Error, CreateHouseholdInviteInput>({
    mutationFn: input => householdApi.createInvite(householdId, input),
    // A freshly minted code has to appear in the household's invite list, or
    // the Invites screen and the Today waiting card both keep describing the
    // previous state of the world.
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
