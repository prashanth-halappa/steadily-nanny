// Generic constants shared between the API and its clients.
//
// Error codes live in `./errorCodes`. This module holds pagination defaults and
// the subscription-tier / entitlement structure for the monetization kit.

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Subscription tiers
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_TIERS = { FREE: 'free', PRO: 'pro' } as const;
export type SubscriptionTier =
  (typeof SUBSCRIPTION_TIERS)[keyof typeof SUBSCRIPTION_TIERS];

/**
 * Maps a store entitlement identifier to the subscription tier it grants.
 *
 * The key is your RevenueCat entitlement identifier; the app reads this map
 * when reconciling entitlements from the store into a `SubscriptionTier`.
 */
export const ENTITLEMENT_TIER_MAP = {
  // SETUP: replace with your RevenueCat entitlement identifier
  'yourapp-pro-entitlement': 'pro',
} as const;
