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

import { useCallback } from 'react';
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

/**
 * Reactive accessor for the flags above. Use this, NOT
 * `useTodayCardDismissalStore(s => s.isDismissed)`.
 *
 * `isDismissed` and `dismiss` are stable function references created once
 * when the store is built — only `dismissedKeys` changes on a `set()`. So a
 * component that selects the FUNCTION is subscribed to something that never
 * changes, and zustand never re-renders it when a key is dismissed: the write
 * reaches MMKV, but the card stays on screen until the next launch. Found
 * on-device by Maestro against `NoWeekYetCard`, where "Hide this" looked
 * completely dead. Selecting `dismissedKeys` subscribes to the VALUE, so the
 * dismissal is visible in the same render pass.
 *
 * Three callers deliberately keep the NON-reactive read and must not be
 * migrated: `useMomentOnce` and `TodayScreen` both keep their own
 * `useState`/effect and re-render themselves, and making `TodayScreen`
 * reactive would hide the joined-household card mid-reveal; and
 * `WeeklyHoursNotSetCard`'s `useMomentPeek` snapshots on mount on purpose, so
 * it does not pop up underneath a celebration that marks itself seen mid-mount.
 */
export function useCardDismissal(): {
  isDismissed: (key: string) => boolean;
  dismiss: (key: string) => void;
} {
  const dismissedKeys = useTodayCardDismissalStore(s => s.dismissedKeys);
  const dismiss = useTodayCardDismissalStore(s => s.dismiss);
  const isDismissed = useCallback(
    (key: string) => dismissedKeys[key] === true,
    [dismissedKeys]
  );
  return { isDismissed, dismiss };
}
