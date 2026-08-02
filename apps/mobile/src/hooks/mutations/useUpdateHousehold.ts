import type {
  Household,
  UpdateHouseholdInput,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface UpdateHouseholdVariables {
  householdId: string;
  input: UpdateHouseholdInput;
}

/**
 * Updates a household's mutable fields (name, timezone, address, approval
 * policy). Callers should pass only the fields that actually changed — see
 * `householdApi.update`'s header comment.
 */
export function useUpdateHousehold() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Household, Error, UpdateHouseholdVariables>({
    mutationFn: ({ householdId, input }) =>
      householdApi.update(householdId, input),
    onSuccess: (_household, { householdId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.household.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.household.detail(householdId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
