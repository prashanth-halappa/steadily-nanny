/**
 * subscriptionStore.ts
 *
 * Subscription tier state. Deliberately store-agnostic: it holds the resolved
 * `tier` / `isPro` only. The integrator wires a billing SDK (RevenueCat, etc.)
 * and feeds the store's active entitlement IDs in via setFromEntitlements.
 * `isPro` is persisted so gated UI renders correctly offline and before the
 * first entitlement sync of a session.
 */

import {
  ENTITLEMENT_TIER_MAP,
  SUBSCRIPTION_TIERS,
  type SubscriptionTier,
} from '@yourapp/shared-types/constants';
import { createPersistedStore } from './createPersistedStore';

/** Resolve the tier an entitlement grants, if any. */
const tierForEntitlement = (id: string): SubscriptionTier | undefined =>
  (ENTITLEMENT_TIER_MAP as Record<string, SubscriptionTier>)[id];

export interface SubscriptionState {
  /** Resolved subscription tier. */
  tier: SubscriptionTier;
  /** Convenience flag — true when the tier grants Pro access. */
  isPro: boolean;
  /**
   * Whether the billing SDK (RevenueCat, etc.) has finished `configure()`.
   * GOLDEN (App Store 2.1a): the paywall-readiness guard reads this — any
   * `Purchases.*` call before configure() is a native Swift fatalError.
   * NOT persisted (per-session).
   */
  isConfigured: boolean;
  /** Last billing-SDK configuration error, if any. NOT persisted. */
  configError: string | null;

  /** Set the tier directly (e.g. from a server sync response). */
  setTier: (tier: SubscriptionTier) => void;
  /** Resolve the tier from the store's active entitlement IDs. */
  setFromEntitlements: (activeEntitlementIds: string[]) => void;
  /** Beta override: when true, grant Pro to everyone. Never revokes. */
  applyBetaOverride: (betaAllPro: boolean) => void;
  /** Record the billing SDK's configuration result. */
  setConfigured: (isConfigured: boolean, error?: string | null) => void;
  /** Reset to the free tier (e.g. on account switch). */
  reset: () => void;
}

const initialState = {
  tier: SUBSCRIPTION_TIERS.FREE,
  isPro: false,
} satisfies Pick<SubscriptionState, 'tier' | 'isPro'>;

export const useSubscriptionStore = createPersistedStore<SubscriptionState>(
  set => ({
    ...initialState,
    isConfigured: false,
    configError: null,

    setTier: tier => set({ tier, isPro: tier === SUBSCRIPTION_TIERS.PRO }),

    setConfigured: (isConfigured, error = null) =>
      set({ isConfigured, configError: error }),

    setFromEntitlements: activeEntitlementIds => {
      const grantsPro = activeEntitlementIds.some(
        id => tierForEntitlement(id) === SUBSCRIPTION_TIERS.PRO
      );
      const tier = grantsPro ? SUBSCRIPTION_TIERS.PRO : SUBSCRIPTION_TIERS.FREE;
      set({ tier, isPro: tier === SUBSCRIPTION_TIERS.PRO });
    },

    applyBetaOverride: betaAllPro => {
      // The override only ever grants Pro; it never downgrades a paying user.
      if (betaAllPro) {
        set({ tier: SUBSCRIPTION_TIERS.PRO, isPro: true });
      }
    },

    reset: () => set({ ...initialState }),
  }),
  {
    name: 'subscription-storage',
    version: 1,
    partialize: state => ({ tier: state.tier, isPro: state.isPro }),
  }
);
