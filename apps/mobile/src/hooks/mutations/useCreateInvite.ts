import type {
  CreateHouseholdInviteInput,
  HouseholdInvite,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Generates an invite code for a household (parents only, enforced server-side). */
export function useCreateInvite(householdId: string) {
  const { t } = useTranslation('errors');

  return useMutation<HouseholdInvite, Error, CreateHouseholdInviteInput>({
    mutationFn: input => householdApi.createInvite(householdId, input),
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
