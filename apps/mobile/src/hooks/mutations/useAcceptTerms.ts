/** @module hooks/mutations/useAcceptTerms — the binding act (§7.3). Parents only. */
import type {
  AcceptTermsProposalRequest,
  TermsProposal,
} from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/**
 * Keyed by PROPOSAL ID, not by (household, carer): the review screen is
 * reached from a push deep link or an inbox row that knows only the id, and
 * it learns the pair from the row it fetched. The invalidations below read
 * the pair off the ACCEPTED ROW that comes back, which is the same pair the
 * server resolved, so nothing has to be guessed before the read that supplies
 * it.
 */

/**
 * Accepts a proposal. This is the ONE act in the domain that creates money:
 * server-side it inserts a real `pay_arrangements` row through the existing
 * command service, under the accepting parent's own credentials (D-35, §17).
 *
 * `responsibility_confirmed` is `z.literal(true)` on the wire — an acceptance
 * without D-7's liability checkbox is refused before it leaves the device.
 *
 * Acceptance therefore reaches further than any other mutation here, and the
 * invalidations have to follow it:
 *  - `termsProposal.current` / `.history` — the row leaves `proposed`.
 *  - `pay.current` / `pay.history` — an arrangement now EXISTS where none did.
 *  - `user.memberships()` — acceptance flips the carer's membership from
 *    candidate to active, and `useIsOnboarded` reads memberships to decide
 *    whether she is still in onboarding.
 *  - `timesheet.all` — a new arrangement can flip a week's earnings state
 *    (`no_arrangement` -> `ok`). This invalidation used to live on
 *    `useCreatePayArrangement`; P1 deleted that hook, and acceptance is the
 *    only writer left, so it inherits the responsibility. Without it the week
 *    she has just unblocked keeps reading "no pay rate set".
 */
export function useAcceptTerms(proposalId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<TermsProposal, Error, AcceptTermsProposalRequest>({
    mutationFn: input => termsProposalApi.accept(proposalId, input),
    onSuccess: accepted => {
      const { household_id: householdId, carer_id: carerId } = accepted;
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.detail(proposalId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.current(householdId, carerId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.list(householdId, carerId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.current(householdId, carerId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pay.history(householdId, carerId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.user.memberships(),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
