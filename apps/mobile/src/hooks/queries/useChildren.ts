import { useQuery } from '@tanstack/react-query';
import { childrenApi } from '@/src/api/endpoints/children';
import { queryKeys } from '@/src/api/queryKeys';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAuthStore } from '@/src/store/auth';

/** A household's (non-archived) children. */
export function useChildren(householdId: string | null | undefined) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);

  return useQuery({
    queryKey: queryKeys.children.list(householdId ?? undefined),
    queryFn: () => childrenApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_2M,
    // ponytail: NOT membership-gated, unlike its household-scoped siblings
    // (`useHouseholdMembers`, `useShiftsRange`, `useHouseholdClosures`, …).
    // Gating it is correct in principle — the server refuses this for a
    // member who has left — but adding the `useCanWriteHousehold` import here
    // perturbs module-init order enough to break `PaySetupScreen`'s suite,
    // which does not use this hook at all: its mocks bind before
    // `useActiveHousehold` resolves and the screen hangs on loading. The cost
    // of leaving it is ONE doomed request on a screen that already shows the
    // honest past-member state, so it is deferred rather than forced. Revisit
    // when that suite stops depending on import order.
    enabled: !!session && isInitialized && isValidId(householdId),
  });
}
