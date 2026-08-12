/** @module hooks/mutations/useProposeTerms — put terms on the table (D-35). Either side may. */
import type {
  CreateTermsProposalRequest,
  TermsProposal,
} from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Proposes terms for one (household, carer) pair. A proposal is a MESSAGE
 * about money, not a record of it — nothing is priced and no arrangement
 * exists until a parent accepts.
 *
 * Invalidates the whole `termsProposal` prefix, not the two exact keys: the
 * new row is what "current" resolves to, it appends to the chain §7.2
 * renders, AND it is what the nanny's draft home reads under
 * `draftQueries`' `['termsProposal', 'draft', householdId]` — a key the two
 * exact invalidations could not match, so writing her terms left the card
 * that sent her here showing the old ones.
 */
export function useProposeTerms(householdId: string, carerId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<TermsProposal, Error, CreateTermsProposalRequest>({
    mutationFn: input => termsProposalApi.propose(householdId, carerId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.all,
      });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
