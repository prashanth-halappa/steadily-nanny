import type {
  CreateHouseholdInput,
  Household,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';
import { useSetupProgressStore } from '@/src/store/setupProgress';

/**
 * Creates a household — the caller becomes its owner. Used as the first step
 * of the parent setup flow (a household must exist before children/invites).
 * Caches the resulting id on `setupProgress` so later steps don't need to
 * refetch the households list just to find it.
 */
export function useCreateHousehold() {
  const queryClient = useQueryClient();
  const setHouseholdId = useSetupProgressStore(s => s.setHouseholdId);
  const { t } = useTranslation('errors');

  return useMutation<Household, Error, CreateHouseholdInput>({
    mutationFn: input => householdApi.create(input),
    onSuccess: household => {
      setHouseholdId(household.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
