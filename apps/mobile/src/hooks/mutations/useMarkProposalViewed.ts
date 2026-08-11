/** @module hooks/mutations/useMarkProposalViewed — §5.3's "Viewed" read receipt. Fire-and-forget. */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';

/**
 * Stamps `viewed_at` the first time the review screen mounts WITH DATA — the
 * fact behind the "Viewed" row on the sender's draft home (§5.3, §11 event 5).
 * Whether, never how many times: the server ignores every call after the first.
 *
 * NO error toast, deliberately. Nobody pressed anything — this fires off a
 * mount — so a failed read receipt is not a user-visible event, and a toast
 * would report a problem the person reading the terms has no idea about and
 * cannot act on.
 *
 * Only `history` is invalidated: the receipt changes a field ON the row, it
 * does not change WHICH proposal is live, so `current` has nothing to refetch.
 */
export function useMarkProposalViewed(proposalId: string) {
  const queryClient = useQueryClient();

  return useMutation<TermsProposal, Error, void>({
    mutationFn: () => termsProposalApi.markViewed(proposalId),
    onSuccess: viewed => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.termsProposal.list(
          viewed.household_id,
          viewed.carer_id
        ),
      });
    },
  });
}
