/**
 * Entitlement gating service — the central feature-access decision engine.
 *
 * Check order (preserved from the source, load-bearing):
 * 1. Beta flag (per-user override wins over global `app_config.beta_all_pro`).
 * 2. Feature-gate existence — unknown features fail open.
 * 3. Tier-based limit — 0 = paywall, null = unlimited.
 * 4. Usage quota (atomic consume for the write path).
 *
 * @module domains/subscription/services/entitlementGatingService
 */
import { supabaseService } from '../../../config/supabase';
import { logger } from '../../../middlewares/logger';
import { cache, TTL } from '../../../utils/cache';
import { FEATURE_GATES, getFeatureLimit } from '../config/featureGates';
import {
  PaywallRequiredError,
  UsageLimitExceededError,
} from '../errors/subscriptionErrors';
import type { EntitlementCheckResult } from '../types';
import { SubscriptionQueryService } from './subscriptionQueryService';
import { UsageTrackingService } from './usageTrackingService';

const BETA_CACHE_KEY = 'subscription:beta_all_pro';
const betaOverrideCacheKey = (userId: string): string =>
  `subscription:beta_override:${userId}`;

// NodeCache returns undefined for a miss, so "no override row" is stored as this
// sentinel to distinguish it from an un-cached key.
const NO_OVERRIDE = 'none';

export class EntitlementGatingService {
  /**
   * Check whether a user is entitled to use a feature (read-only).
   */
  static async checkEntitlement(
    userId: string,
    feature: string
  ): Promise<EntitlementCheckResult> {
    try {
      // 1. Beta (per-user override wins over the global flag).
      if (await EntitlementGatingService.isBetaAllPro(userId)) {
        return { allowed: true };
      }

      // 2. Unknown feature — fail-open.
      if (!FEATURE_GATES[feature]) {
        return { allowed: true };
      }

      // 3. Tier limit.
      const { tier } =
        await SubscriptionQueryService.getSubscriptionInfo(userId);
      const limit = getFeatureLimit(feature, tier);
      if (limit === null) {
        return { allowed: true };
      }
      if (limit === 0) {
        return { allowed: false, reason: 'paywall_required' };
      }

      // 4. Usage quota.
      const usage = await UsageTrackingService.getUsage(userId, feature);
      if (usage.used >= limit) {
        return { allowed: false, reason: 'usage_limit_exceeded', usage };
      }

      return { allowed: true };
    } catch (error) {
      // Fail-closed: on any error, treat as denied.
      logger.error('Entitlement check failed, defaulting to denied', {
        userId,
        feature,
        error: error instanceof Error ? error.message : String(error),
      });
      return { allowed: false, reason: 'feature_disabled' };
    }
  }

  /** Require entitlement; throws PaywallRequiredError / UsageLimitExceededError. */
  static async requireEntitlement(
    userId: string,
    feature: string
  ): Promise<void> {
    const result = await EntitlementGatingService.checkEntitlement(
      userId,
      feature
    );
    if (!result.allowed) {
      if (result.reason === 'usage_limit_exceeded' && result.usage) {
        throw new UsageLimitExceededError(feature, {
          feature: result.usage.feature,
          used: result.usage.used,
          limit: result.usage.limit ?? 0,
          remaining: 0,
          resetsAt: result.usage.resetsAt,
          periodType: result.usage.periodType,
        });
      }
      throw new PaywallRequiredError(feature);
    }
  }

  /**
   * Require remaining quota AND consume one unit atomically (closes the
   * usage-quota TOCTOU). Callers must NOT separately record usage afterwards.
   */
  static async requireUsageQuota(
    userId: string,
    feature: string
  ): Promise<void> {
    const isBeta = await EntitlementGatingService.isBetaAllPro(userId);

    let limit: number | null;
    if (isBeta) {
      limit = null; // Unlimited, but still metered.
    } else {
      if (!FEATURE_GATES[feature]) {
        return; // Unknown feature — fail-open, nothing to meter.
      }
      const { tier } =
        await SubscriptionQueryService.getSubscriptionInfo(userId);
      limit = getFeatureLimit(feature, tier);
    }

    if (limit === 0) {
      throw new PaywallRequiredError(feature);
    }

    let allowed: boolean;
    try {
      allowed = await UsageTrackingService.consumeQuota(userId, feature, limit);
    } catch (error) {
      logger.error('Usage quota consume failed, defaulting to denied', {
        userId,
        feature,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PaywallRequiredError(feature);
    }

    if (!allowed) {
      const usage = await UsageTrackingService.getUsage(userId, feature);
      throw new UsageLimitExceededError(feature, {
        feature: usage.feature,
        used: usage.used,
        limit: usage.limit ?? 0,
        remaining: 0,
        resetsAt: usage.resetsAt,
        periodType: usage.periodType,
      });
    }
  }

  /**
   * Whether the caller should be treated as Pro via beta mode. A per-user
   * override wins over the global flag. Uses `??` so an explicit deny (`false`)
   * is respected even while the global flag is on.
   */
  static async isBetaAllPro(userId?: string, email?: string): Promise<boolean> {
    const override = userId
      ? await EntitlementGatingService.getUserBetaOverride(userId, email)
      : null;
    return override ?? (await EntitlementGatingService.getGlobalBetaAllPro());
  }

  /**
   * Per-user beta override, matched on user_id OR email (so an override added by
   * either identifier — even before the account existed — is honored). Cached
   * 5 minutes.
   */
  static async getUserBetaOverride(
    userId: string,
    email?: string
  ): Promise<boolean | null> {
    const cacheKey = betaOverrideCacheKey(userId);
    const cached = cache.get<boolean | typeof NO_OVERRIDE>(cacheKey);
    if (cached !== undefined) {
      return cached === NO_OVERRIDE ? null : cached;
    }

    try {
      let resolvedEmail = email;
      if (!resolvedEmail) {
        const { data } = await supabaseService.auth.admin.getUserById(userId);
        resolvedEmail = data.user?.email ?? undefined;
      }

      let query = supabaseService
        .from('user_beta_overrides')
        .select('beta_all_pro');

      query = resolvedEmail
        ? query.or(`user_id.eq.${userId},email.ilike.${resolvedEmail}`)
        : query.eq('user_id', userId);

      const { data, error } = await query.limit(1).maybeSingle();

      if (error) {
        logger.warn('Failed to read user beta override, ignoring', {
          userId,
          error: error.message,
        });
        cache.set(cacheKey, NO_OVERRIDE, TTL.SHORT);
        return null;
      }

      const value =
        typeof data?.beta_all_pro === 'boolean' ? data.beta_all_pro : null;
      cache.set(cacheKey, value === null ? NO_OVERRIDE : value, TTL.SHORT);
      return value;
    } catch (error) {
      logger.warn('Failed to read user beta override, ignoring', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(cacheKey, NO_OVERRIDE, TTL.SHORT);
      return null;
    }
  }

  /**
   * Global `app_config.beta_all_pro` flag. Cached 5 minutes. Fail-CLOSED:
   * defaults to false on any read error (server-side gating must not fail open).
   */
  static async getGlobalBetaAllPro(): Promise<boolean> {
    const cached = cache.get<boolean>(BETA_CACHE_KEY);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const { data, error } = await supabaseService
        .from('app_config')
        .select('beta_all_pro')
        .limit(1)
        .single();

      if (error) {
        logger.warn('Failed to read beta_all_pro flag, defaulting to false', {
          error: error.message,
        });
        cache.set(BETA_CACHE_KEY, false, TTL.SHORT);
        return false;
      }

      const isBeta = data?.beta_all_pro === true;
      cache.set(BETA_CACHE_KEY, isBeta, TTL.SHORT);
      return isBeta;
    } catch (error) {
      logger.warn('Failed to read beta_all_pro flag, defaulting to false', {
        error: error instanceof Error ? error.message : String(error),
      });
      cache.set(BETA_CACHE_KEY, false, TTL.SHORT);
      return false;
    }
  }
}
