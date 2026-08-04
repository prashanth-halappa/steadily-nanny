/**
 * @module hooks/queries/useActiveHousehold
 *
 * SINGLE CHOKE POINT for "which household's data should this screen show" —
 * Wave B. A nanny can be an accepted member of more than one household (she
 * works for several families); `useHouseholds()` returns all of them with no
 * inherent order the UI should read anything into, so `households.data?.[0]`
 * always showing the SAME one regardless of which family the nanny actually
 * wants right now was a real bug, not just an edge case.
 *
 * This hook reconciles the user's persisted preference (`activeHousehold`
 * Zustand store) against the CURRENT household list on every read:
 *   - No preference yet, or the preferred id no longer appears in the list
 *     (left that household, or a fresh install) -> fall back to the first
 *     household in the list.
 *   - Preference present and still valid -> use it.
 *
 * A parent (Wave 1: owns exactly one household) always has exactly one entry
 * in `households`, so the fallback-to-first behavior means this hook returns
 * the same household `useIsOnboarded` would have — no behavior change for
 * that role.
 *
 * Deliberately does NOT touch role detection (`useIsOnboarded` owns that) —
 * this hook only ever answers "which household", never "what am I in this
 * household".
 */

import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useCallback, useMemo } from 'react';
import { useActiveHouseholdStore } from '@/src/store/activeHousehold';
import { useHouseholds } from './useHouseholds';

export interface UseActiveHouseholdResult {
  /** The resolved active household, or null before the list has loaded / if
   * the user has none. */
  household: Household | null;
  /** Convenience accessor — `household?.id ?? null`. */
  householdId: string | null;
  /** The user's full household list, unfiltered. */
  households: Household[];
  /** Persist a new preferred household (e.g. from the switcher UI). Must be
   * an id present in `households` to take effect on the next read. */
  setActiveHouseholdId: (householdId: string) => void;
  /** True while the households query has not yet resolved (TanStack
   * `isPending` — includes pending+idle, not only in-flight fetches). */
  isLoading: boolean;
  /** True when the underlying households list query failed — callers that
   * treat an empty list as "no households" must OR this in so a network
   * failure does not collapse to empty-success. */
  isError: boolean;
}

export function useActiveHousehold(): UseActiveHouseholdResult {
  const householdsQuery = useHouseholds();
  const preferredHouseholdId = useActiveHouseholdStore(
    s => s.preferredHouseholdId
  );
  const setPreferredHouseholdId = useActiveHouseholdStore(
    s => s.setPreferredHouseholdId
  );

  const households = useMemo(
    () => householdsQuery.data ?? [],
    [householdsQuery.data]
  );

  const household = useMemo(() => {
    if (households.length === 0) return null;
    const preferred = preferredHouseholdId
      ? households.find(h => h.id === preferredHouseholdId)
      : undefined;
    // Preference missing or stale (household left / never chosen) — the
    // first household is as good a default as any, and matches what a
    // single-household parent already saw before this hook existed.
    return preferred ?? households[0] ?? null;
  }, [households, preferredHouseholdId]);

  const setActiveHouseholdId = useCallback(
    (householdId: string) => setPreferredHouseholdId(householdId),
    [setPreferredHouseholdId]
  );

  return {
    household,
    householdId: household?.id ?? null,
    households,
    setActiveHouseholdId,
    // `isPending`, not `isLoading`: TanStack v5's isLoading is false while a
    // query is still unresolved but not fetching yet (pending+idle — e.g.
    // disabled→enabled, right after queryClient.clear()). Callers that treat
    // "not loading" as "list is known" would briefly see an empty household
    // list and mis-route. isPending covers that gap.
    isLoading: householdsQuery.isPending,
    isError: householdsQuery.isError,
  };
}
