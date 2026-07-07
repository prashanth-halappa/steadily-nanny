/**
 * Subscription query service — read operations. Returns subscription info for a
 * user, defaulting to free tier if no mirror row exists (or on any error).
 *
 * @module domains/subscription/services/subscriptionQueryService
 */
import type { SubscriptionTier } from '@yourapp/shared-types';
import { SUBSCRIPTION_TIERS } from '@yourapp/shared-types';
import { logger } from '../../../middlewares/logger';
import { SubscriptionRepository } from '../repositories/subscriptionRepository';
import type { SubscriptionInfo } from '../types';

/**
 * Grace window applied to a mirror row's `expires_at` before it is treated as
 * free — tolerates a slightly-late EXPIRATION webhook / clock skew.
 */
const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

export class SubscriptionQueryService {
  static async getSubscriptionInfo(userId: string): Promise<SubscriptionInfo> {
    try {
      const row = await SubscriptionRepository.findByUserId(userId);

      if (!row) {
        return {
          tier: 'free',
          expiresAt: null,
          productId: null,
          platform: null,
        };
      }

      const knownTiers = Object.values(SUBSCRIPTION_TIERS) as string[];
      let tier: SubscriptionTier = knownTiers.includes(row.tier)
        ? (row.tier as SubscriptionTier)
        : 'free';

      // Don't trust a paid mirror tier past its expiry — a missed EXPIRATION
      // webhook would otherwise grant free Pro. A null expires_at is honored.
      if (tier !== 'free' && row.expires_at) {
        const expiresMs = Date.parse(row.expires_at);
        if (
          !Number.isNaN(expiresMs) &&
          expiresMs + EXPIRY_GRACE_MS < Date.now()
        ) {
          logger.info('Subscription mirror tier expired; treating as free', {
            userId,
            tier,
            expiresAt: row.expires_at,
          });
          tier = 'free';
        }
      }

      return {
        tier,
        expiresAt: row.expires_at,
        productId: row.product_id,
        platform: row.platform,
      };
    } catch (error) {
      logger.error('Failed to get subscription info, defaulting to free', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { tier: 'free', expiresAt: null, productId: null, platform: null };
    }
  }
}
