/**
 * todayCardDismissalStore.ts
 *
 * Generic "show this Today card once, then remember it was dismissed" flag,
 * for the L3 cards that have no bottom-sheet `onDismiss` to hang state off
 * (unlike every other dismissible surface in the app). Keyed by an arbitrary
 * caller-chosen string so one store covers every such card instead of one
 * persisted store per card:
 *   - the §9.2 "Send my terms" card keys by `sendTerms:${draftHouseholdId}:${liveHouseholdId}`
 *     (`SendMyTermsCard.tsx`) so joining a second family re-offers it.
 *   - the §8.1 joined-household card keys by `joinedHousehold:${householdId}`
 *     (`TodayScreen.tsx`) so it shows once per household joined.
 *   - the parent-side nanny-joined moment keys by `nannyJoined:${householdId}:${nannyUserId}`
 *     (`TodayScreen.tsx`) so a second nanny joining is its own reveal.
 *   - the first clock-in moment keys by `firstClockIn:${householdId}`
 *     (`TodayScreen.tsx`) so it fires once per relationship.
 *   - the first week-approved moment keys by `firstWeekApproved:${householdId}`
 *     (`TodayScreen.tsx`) so a later approved week is not a moment.
 *
 * Persisted to MMKV so a dismissal survives app restarts; reset on
 * account switch (`resetStores.ts`) so one user's dismissals don't hide a
 * card the next user on the same device hasn't seen yet.
 */

import { createPersistedStore } from './createPersistedStore';

export interface TodayCardDismissalState {
  dismissedKeys: Record<string, true>;
  dismiss: (key: string) => void;
  isDismissed: (key: string) => boolean;
  reset: () => void;
}

export const useTodayCardDismissalStore =
  createPersistedStore<TodayCardDismissalState>(
    (set, get) => ({
      dismissedKeys: {},

      dismiss: key =>
        set(state => ({
          dismissedKeys: { ...state.dismissedKeys, [key]: true },
        })),

      isDismissed: key => get().dismissedKeys[key] === true,

      reset: () => set({ dismissedKeys: {} }),
    }),
    {
      name: 'today-card-dismissal-storage',
      version: 1,
      partialize: state => ({ dismissedKeys: state.dismissedKeys }),
    }
  );
