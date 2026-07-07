/**
 * Feature gate configuration — tier-keyed limits for monetization.
 *
 * `null` = unlimited, `0` = blocked (hard paywall), `N` = quota per period.
 *
 * SETUP: replace these two example gates with your product's features.
 *
 * @module domains/subscription/config/featureGates
 */
import type { SubscriptionTier } from '@yourapp/shared-types';

interface FeatureGateConfig {
  description: string;
  period: 'daily' | 'weekly' | 'monthly';
  limits: Record<SubscriptionTier, number | null>;
  chargedAfter: 'db_insert' | 'first_token' | 'completion' | 'none';
}

export const FEATURE_GATES: Record<string, FeatureGateConfig> = {
  // Example: free users get 3 widget creations/week; pro unlimited.
  widget_creation: {
    description: 'Create a widget',
    period: 'weekly',
    limits: { free: 3, pro: null },
    chargedAfter: 'db_insert',
  },
  // Example: free users get 5 AI generations/day; pro unlimited.
  llm_generation: {
    description: 'AI-powered generation',
    period: 'daily',
    limits: { free: 5, pro: null },
    chargedAfter: 'completion',
  },
} as const;

export type FeatureKey = keyof typeof FEATURE_GATES;

/**
 * Limit for a feature and tier: null (unlimited), 0 (blocked), or a positive
 * quota. Unknown feature = unlimited (fail-open); unknown tier falls back to
 * free limits.
 */
export function getFeatureLimit(
  feature: string,
  tier: SubscriptionTier
): number | null {
  const gate = FEATURE_GATES[feature];
  if (!gate) return null;
  if (tier in gate.limits) return gate.limits[tier];
  return gate.limits.free ?? null;
}
