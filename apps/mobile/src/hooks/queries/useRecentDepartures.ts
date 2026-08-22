/**
 * @module hooks/queries/useRecentDepartures
 *
 * Memberships of one household that ended in the last week — the read behind
 * the parent-side departure cards on Today.
 *
 * PARENT-ONLY, and the caller enforces that by passing `undefined` rather
 * than by hiding the card: the route is parent-only server-side, so an
 * enabled query on a carer's Today screen is a guaranteed 403 on every
 * launch. Same `enabled` triad as every other household-scoped read here
 * (`useHouseholdMembers` is the model), so a signed-out or half-initialised
 * app never puts it on the wire either.
 *
 * `STALE_5M` matches `useHouseholdMembers`: this is the same underlying
 * table, and a departure is not a fact that needs to arrive within seconds —
 * the card is a note, not an alert.
 */
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

export function useRecentDepartures(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.household.departed(householdId ?? undefined),
    queryFn: () => householdApi.listDeparted(householdId as string),
    staleTime: QUERY_TIMING.STALE_5M,
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
