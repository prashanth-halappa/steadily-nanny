/** @module hooks/mutations/useCreateHouseholdClosure — declare a household closure. Owner/parent only. */
import type {
  CreateHouseholdClosureInput,
  HouseholdClosure,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { householdClosureApi } from '@/src/api/endpoints/householdClosures';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Creates a household closure. A non-parent gets a 403 (`errors:forbidden`). */
export function useCreateHouseholdClosure(householdId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<HouseholdClosure, Error, CreateHouseholdClosureInput>({
    mutationFn: input => householdClosureApi.create(householdId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.householdClosures.list(householdId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
