/**
 * Subscription domain types.
 *
 * @module domains/subscription/types
 */
import type { SubscriptionTier } from '@yourapp/shared-types';

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  expiresAt: string | null;
  productId: string | null;
  platform: string | null;
}

export interface UsageStatus {
  feature: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  resetsAt: string;
  periodType: 'daily' | 'weekly' | 'monthly';
}

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: 'paywall_required' | 'usage_limit_exceeded' | 'feature_disabled';
  usage?: UsageStatus;
}

/** RevenueCat webhook event payload (simplified). */
export interface RevenueCatWebhookPayload {
  api_version: string;
  event: {
    id: string;
    type: string;
    app_user_id: string;
    product_id: string;
    // Nullable / omitted for some event types and unmapped products.
    entitlement_ids: string[] | null;
    event_timestamp_ms: number;
    expiration_at_ms: number | null;
    store: string;
    environment: string;
    period_type: 'TRIAL' | 'INTRO' | 'NORMAL' | string | null;
    is_trial_conversion: boolean | null;
    price: number | null;
    purchased_at_ms: number | null;
  };
}
