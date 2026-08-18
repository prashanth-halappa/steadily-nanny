/** @module hooks/mutations/useRemindTerms — nudge a round nobody has answered. */
import type { RemindTermsProposalResponse } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

/** The server's `metadata.reason` for "not yet" — 48h on either clock. */
const TOO_SOON_REASON = 'TERMS_PROPOSAL_REMINDER_TOO_SOON';

/**
 * Whether a failed nudge was the 48-hour refusal rather than a real error.
 *
 * Read off `metadata.reason` and never off the message — `ConflictError`
 * fixes the client-visible `code` to `CONFLICT` for every 409 in the app, so
 * `reason` is the only field that tells this one apart (the same convention
 * `errorLocalization.ts` uses for `NO_PAY_ARRANGEMENT`).
 *
 * It matters that this is precise in the FALSE direction: a dropped
 * connection must not be reported as "you already sent one", because the
 * reader would then wait two days for a nudge that never left.
 */
export function isRemindTooSoon(error: unknown): boolean {
  const reason = (
    error as
      | {
          response?: { data?: { error?: { metadata?: { reason?: string } } } };
        }
      | undefined
  )?.response?.data?.error?.metadata?.reason;
  return reason === TOO_SOON_REASON;
}

/**
 * WP-G — asks the other side to look at an open round. One tap, never
 * automatic, and at most one every two days.
 *
 * TWO DELIBERATE DIFFERENCES from the other terms mutations:
 *
 * - The 48-hour refusal gets NO TOAST. It is the answer to the tap the
 *   reader just made, and "come back on Thursday" needs to stay on screen
 *   long enough to be acted on — so the component renders it inline and this
 *   hook stays quiet for exactly that case. Everything else still toasts: a
 *   nudge that never left the device must not look sent.
 * - Only the proposal's own detail query is invalidated. A reminder changes
 *   nothing about the row — no status, no `updated_at` — so blowing away the
 *   `current`/`list` caches would be refetching to display the same bytes.
 */
export function useRemindTerms(proposalId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<RemindTermsProposalResponse, Error, void>({
    mutationFn: () => termsProposalApi.remind(proposalId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.detail(proposalId),
      });
    },
    onError: error => {
      if (isRemindTooSoon(error)) return;
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
