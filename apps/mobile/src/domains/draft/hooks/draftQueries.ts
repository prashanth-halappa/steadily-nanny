/**
 * @module domains/draft/hooks/draftQueries
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ SEAM — MOVE ME. These three belong in `src/api/endpoints/*`,          │
 * │ `src/api/queryKeys.ts` and `src/hooks/queries|mutations/*` alongside  │
 * │ every other query in the app. They live here only because 3-O's       │
 * │ mobile-data slice and this screen were built in parallel and the      │
 * │ endpoints did not exist yet. Reconciliation is a file move plus a     │
 * │ re-export; nothing in this domain reads them by any other name.       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * `useDraftInvites` — every `household_invites` row for a household, which is
 * §5.2's "Sent to" list. `GET /v1/households/:id/invites` now backs this — it did not
 * exist when this hook was written, so every call fell through to an
 * unregistered path. The parent flow used to hold only the ONE invite it had
 * just minted; both a nanny running four interviews and a parent who closed
 * the app after generating a code need the list.
 *
 * `useDraftProposal` — her drafted terms. In a draft household nothing can
 * insert a `pay_arrangements` row (there is no owner and no parent, so
 * `WRITE_ROLES = {owner, parent}` matches nobody), so the terms she authored
 * live as a `terms_proposals` row and that row is what this screen renders.
 * Its `weekly_equivalent_minor` is server-computed and is the ONLY weekly
 * figure the screen may print (§17).
 */
import {
  HOUSEHOLD_STATES,
  type HouseholdInvite,
  HouseholdInviteSchema,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';
import { termsProposalApi } from '@/src/api/endpoints/termsProposals';
import { queryKeys } from '@/src/api/queryKeys';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';

/** Namespaced so a move into `queryKeys.ts` keeps the same shape. */
export const draftQueryKeys = {
  invites: queryKeys.household.invites,
  // The SAME key the rest of the app reads her current round under
  // (`MyPayScreen`, the pay hub) — one cache entry, so saving terms on one
  // surface can never leave the other showing "you haven't written your
  // terms yet".
  proposal: queryKeys.termsProposal.current,
};

export function useDraftInvites(householdId: string | undefined) {
  const session = useAuthStore(s => s.session);

  return useQuery<HouseholdInvite[]>({
    queryKey: draftQueryKeys.invites(householdId),
    queryFn: async () => {
      const response = await apiClient.get(
        `/v1/households/${householdId}/invites`
      );
      const parsed = z
        .object({ household_invites: z.array(HouseholdInviteSchema) })
        .safeParse(response.data.data);
      if (!parsed.success) throw parsed.error;
      return parsed.data.household_invites;
    },
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && !!householdId,
  });
}

/**
 * Her open proposal for this household, or null when she has not written her
 * terms yet. Null is a real answer, not an error — a draft with no terms in
 * it is the state every draft starts in.
 */
export function useDraftProposal(householdId: string | undefined) {
  const session = useAuthStore(s => s.session);
  // Her own id: a nanny's draft round is always hers, and the carer-scoped
  // route is the only one the API mounts (`/households/:id/carers/:carerId/
  // terms-proposals`). This hook used to GET a household-scoped path that
  // was never registered, so EVERY read 404'd — and a 404 is not "no terms
  // yet", it is a query stuck in error: the terms card kept saying she had
  // written nothing, the share CTA stayed disabled on its
  // couldn't-check-terms branch, and `DraftTermsScreen` had no round to
  // supersede, so every re-save POSTed a second open round and the server
  // refused it with a 409 she could not clear by refreshing.
  const carerId = useAuthStore(s => s.user?.id);

  return useQuery<TermsProposal | null>({
    queryKey: draftQueryKeys.proposal(householdId, carerId),
    queryFn: () =>
      // `getCurrent` returns null (not a 404) when she has not written her
      // terms yet — the empty state this screen was always trying to render.
      termsProposalApi.getCurrent(householdId ?? '', carerId ?? ''),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!session && !!householdId && !!carerId,
  });
}

/**
 * Archive the draft (§5.4). Server-side this kills the outstanding codes and
 * removes the draft from her list; it cannot reach a household that already
 * redeemed one, because D-38 copied her terms at redemption rather than
 * sharing a row with them. That is what makes the second consequence line
 * true, and what makes this a safe button rather than a scary one.
 */
export function useArchiveDraft(householdId: string) {
  const { t } = useTranslation('errors');
  const queryClient = useQueryClient();
  const router = useRouter();
  const { households, setActiveHouseholdId } = useActiveHousehold();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await apiClient.post(`/v1/households/${householdId}/archive`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['household'] });
      // The just-archived draft is about to fall out of `households` and
      // into `pastHouseholds` server-side, but that hasn't round-tripped
      // yet — without repointing the preference NOW, `useActiveHousehold`
      // keeps resolving straight back onto it (it's still the preferred id)
      // and the archive looks like it did nothing. Fall back to the next
      // LIVE household from THIS read of the list, excluding the one just
      // archived; `null` when there isn't one, which clears the preference
      // rather than pointing at a dangling id.
      const firstLiveHouseholdId =
        households.find(
          h => h.id !== householdId && h.state === HOUSEHOLD_STATES.LIVE
        )?.id ?? null;
      setActiveHouseholdId(firstLiveHouseholdId);
      router.replace('/(private)/(tabs)/home');
    },
    onError: error => {
      showErrorToast(getLocalizedErrorMessage(error, t));
    },
  });
}
