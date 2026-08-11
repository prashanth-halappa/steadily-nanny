/** @module hooks/mutations/useWithdrawTerms — take back a proposal nobody has answered. */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Withdraws a live proposal. NOT a delete — the row goes `withdrawn` and stays
 * in the chain, because "she took it back" is part of how they got here. Both
 * caches move: `current` loses its live row, `history` keeps it with a new
 * status.
 */
export function useWithdrawTerms(proposalId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<TermsProposal, Error, void>({
    mutationFn: () => termsProposalApi.withdraw(proposalId),
    // The (household, carer) pair comes off the WITHDRAWN ROW, not from the
    // caller: an act on an existing row is keyed by that row's id, and the
    // response is the authoritative source for which pair's caches moved.
    onSuccess: withdrawn => {
      const { household_id: householdId, carer_id: carerId } = withdrawn;
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.detail(proposalId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.current(householdId, carerId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.list(householdId, carerId),
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
