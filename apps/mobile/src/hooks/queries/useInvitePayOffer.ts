/**
 * @module hooks/queries/useInvitePayOffer
 *
 * F3(c) — the pay offer a parent typed onto THIS carer's invite before she
 * existed to hang a real `pay_arrangements`/`terms_proposals` row on (P8).
 * `PaySetupScreen` prefills its form from this instead of asking him to
 * retype terms he already wrote once.
 *
 * Rides `GET /households/:id/invites` — the same list `useCreateInvite` and
 * `useRevokeInvite` already invalidate via `queryKeys.household.invites`, so
 * this shares that cache entry rather than opening a second one.
 */
import type { CreatePayArrangementRequest } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/**
 * The offer on the invite THIS carer actually redeemed, or `null` when her
 * invite carried none (or none of this household's invites match her at
 * all) — a normal, successful result, never an error (docs/11-MONEY.md §4's
 * "absence renders as absence" discipline, applied to an offer instead of a
 * balance).
 */
export function useInvitePayOffer(
  householdId: string | null | undefined,
  carerId: string | null | undefined
) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.household.invites(householdId ?? undefined),
    queryFn: () => householdApi.listInvites(householdId as string),
    select: (invites): CreatePayArrangementRequest | null =>
      invites.find(row => row.accepted_by === carerId && row.pay_offer !== null)
        ?.pay_offer ?? null,
    staleTime: QUERY_TIMING.STALE_1M,
    enabled:
      !!session &&
      isInitialized &&
      isValidId(householdId) &&
      isValidId(carerId),
  });
}
