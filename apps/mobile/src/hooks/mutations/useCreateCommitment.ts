import type {
  ChildCommitment,
  CreateChildCommitmentInput,
} from '@steadily-nanny/shared-types/schemas/child.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { commitmentApi } from '@/src/api/endpoints/commitments';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** Creates a commitment for a child. */
export function useCreateCommitment(householdId: string, childId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<ChildCommitment, Error, CreateChildCommitmentInput>({
    mutationFn: input => commitmentApi.create(householdId, childId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.commitments.list(householdId, childId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
