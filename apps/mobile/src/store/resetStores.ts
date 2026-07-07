/**
 * resetStores.ts
 *
 * Clears the in-memory state of the user-scoped Zustand stores. Call this on
 * account switch / logout so one user's onboarding progress, subscription
 * tier, and notification-primer counters don't leak into the next session.
 *
 * The integrator's auth store is expected to call resetUserScopedStores() as
 * part of its sign-out flow.
 */

import { useNotificationStore } from './notificationStore';
import { useOnboardingStore } from './onboarding';
import { useSubscriptionStore } from './subscriptionStore';

/** Reset every user-scoped store to its initial state. */
export const resetUserScopedStores = (): void => {
  useOnboardingStore.getState().reset();
  useSubscriptionStore.getState().reset();
  useNotificationStore.getState().reset();
};
