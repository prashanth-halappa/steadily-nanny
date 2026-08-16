/**
 * activeHousehold.ts
 *
 * Wave B: a nanny can be an accepted member of more than one household (she
 * works for several families). Persists WHICH household the user last chose
 * to view — `preferredHouseholdId` is a bare preference, not a source of
 * truth: `useActiveHousehold` (the hook built on top of this store) is what
 * reconciles it against the household list that's actually still valid (the
 * preferred id might belong to a household the user has since left, or might
 * be null on a fresh install), never this store alone.
 *
 * A single parent-owned household never needs this: `useActiveHousehold`
 * falls back to the first household in the list, which for a parent (Wave 1:
 * one owned household only) is always the same household `useIsOnboarded`
 * would have picked anyway.
 */

import { createPersistedStore } from './createPersistedStore';

export interface ActiveHouseholdState {
  /** The user's last-chosen household id, or null before any choice is made. */
  preferredHouseholdId: string | null;
  /** Record a new preferred household (e.g. picked from the switcher), or
   * `null` to clear it (§S6 item 6 — after archiving a draft with no other
   * live household to fall back to). */
  setPreferredHouseholdId: (householdId: string | null) => void;
  /** Reset back to no preference (e.g. on account switch). */
  reset: () => void;
}

export const useActiveHouseholdStore =
  createPersistedStore<ActiveHouseholdState>(
    set => ({
      preferredHouseholdId: null,

      setPreferredHouseholdId: householdId =>
        set({ preferredHouseholdId: householdId }),

      reset: () => set({ preferredHouseholdId: null }),
    }),
    {
      name: 'active-household-storage',
      version: 1,
      partialize: state => ({
        preferredHouseholdId: state.preferredHouseholdId,
      }),
    }
  );
