/** @module hooks/mutations/useCounterTerms — answer a proposal with different terms (D-35). */
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

/** A counter always names the round it answers — that is the whole difference. */
type CounterTermsInput = CreateTermsProposalRequest & { supersedes_id: string };

/**
 * WHY THIS IS NOT A SECOND ENDPOINT
 *
 * A counter is the SAME POST as a proposal, with `supersedes_id` set. The
 * append-only chain is what makes §7.2's "How we got here" a real history:
 * countering inserts a NEW row pointing at the one it answered, and the
 * answered row goes `countered` server-side. Nothing is ever edited over.
 * A dedicated `/counter` route would be a second place to build that link,
 * and the day the two disagreed the audit trail would be the casualty.
 *
 * So this hook is deliberately thin: it exists to make `supersedes_id`
 * REQUIRED at the type level for callers who mean "counter", nothing more.
 */
export function useCounterTerms(householdId: string, carerId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<TermsProposal, Error, CounterTermsInput>({
    mutationFn: input => termsProposalApi.propose(householdId, carerId, input),
    onSuccess: () => {
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
