/** @module hooks/mutations/useDeclineTerms — the counterparty's refusal (B4). */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Declines a live proposal — the COUNTERPARTY's own exit, distinct from
 * `useWithdrawTerms` (the author's). NOT a delete — the row goes `declined`
 * and stays in the chain. Both caches move, same shape as withdraw:
 * `current` loses its live row, `history` keeps it with a new status.
 */
export function useDeclineTerms(proposalId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<TermsProposal, Error, void>({
    mutationFn: () => termsProposalApi.decline(proposalId),
    // The (household, carer) pair comes off the DECLINED ROW, not from the
    // caller — same reasoning as `useWithdrawTerms`.
    onSuccess: declined => {
      const { household_id: householdId, carer_id: carerId } = declined;
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
