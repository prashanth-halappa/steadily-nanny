// File: src/api/endpoints/subscription.ts
// API endpoint for reading the caller's authoritative subscription status.

import type { SubscriptionTier } from '@yourapp/shared-types/constants';
import { SUBSCRIPTION_TIERS } from '@yourapp/shared-types/constants';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const subscriptionEndpoints = {
  // API-CONTRACT: GET returns the caller's authoritative subscription status.
  // Post-purchase reconcile = REFETCH this. The app reads the billing SDK
  // (RevenueCat) directly for the fast path; the server learns of purchases via
  // the billing-provider webhook, so there is NO client-posted "sync" endpoint.
  status: '/v1/subscription/status',
  // API-CONTRACT: GET returns per-feature usage counters (for usage-limit UI).
  // Wire a typed getUsage() here if/when your app surfaces usage.
  usage: '/v1/subscription/usage',
} as const;

// API-CONTRACT: status.data is
// { tier, expiresAt?, productId?, platform?, betaAllPro? }.
const SubscriptionStatusSchema = z.object({
  tier: z.enum(
    Object.values(SUBSCRIPTION_TIERS) as [
      SubscriptionTier,
      ...SubscriptionTier[],
    ]
  ),
  expiresAt: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  betaAllPro: z.boolean().optional(),
});

/** Authoritative subscription status from the server. */
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const subscriptionApi = {
  /**
   * Fetch the caller's authoritative subscription status. Refetch to reconcile
   * after a purchase/restore.
   */
  getStatus: async (): Promise<SubscriptionStatus> => {
    const response = await apiClient.get(subscriptionEndpoints.status);
    // API-CONTRACT: unwrap the success envelope — payload lives at data.data.
    const parsed = SubscriptionStatusSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },
};
