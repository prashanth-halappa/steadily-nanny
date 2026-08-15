/**
 * resetStores.ts
 *
 * Clears the in-memory state of the user-scoped Zustand stores. Call this on
 * account switch / logout so one user's onboarding progress and
 * notification-primer counters don't leak into the next session.
 *
 * The integrator's auth store is expected to call resetUserScopedStores() as
 * part of its sign-out flow.
 */

import { useActiveHouseholdStore } from './activeHousehold';
import { useNotificationStore } from './notificationStore';
import { useSetupProgressStore } from './setupProgress';
import { useTodayCardDismissalStore } from './todayCardDismissalStore';

/** Reset every user-scoped store to its initial state. */
export const resetUserScopedStores = (): void => {
  useSetupProgressStore.getState().reset();
  useNotificationStore.getState().reset();
  useActiveHouseholdStore.getState().reset();
  useTodayCardDismissalStore.getState().reset();
};
