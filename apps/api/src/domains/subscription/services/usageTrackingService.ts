/**
 * Usage tracking service — quota status queries and the atomic consume-quota
 * primitive.
 *
 * @module domains/subscription/services/usageTrackingService
 */
import type { SubscriptionTier } from '@yourapp/shared-types';
import { logger } from '../../../middlewares/logger';
import { getPeriodStart } from '../../../utils/dateUtils';
import { FEATURE_GATES, getFeatureLimit } from '../config/featureGates';
import { UsageRepository } from '../repositories/usageRepository';
import type { UsageStatus } from '../types';
import { SubscriptionQueryService } from './subscriptionQueryService';

type Period = 'daily' | 'weekly' | 'monthly';

export class UsageTrackingService {
  static async getUsage(userId: string, feature: string): Promise<UsageStatus> {
    const gate = FEATURE_GATES[feature];
    if (!gate) {
      return {
        feature,
        used: 0,
        limit: null,
        remaining: null,
        resetsAt: new Date().toISOString(),
        periodType: 'daily',
      };
    }

    const { tier } = await SubscriptionQueryService.getSubscriptionInfo(userId);
    const limit = getFeatureLimit(feature, tier);
    const periodStart = getPeriodStart(gate.period);

    const counter = await UsageRepository.getCounter(
      userId,
      feature,
      gate.period,
      periodStart
    );

    const used = counter?.count ?? 0;
    const remaining = limit === null ? null : Math.max(0, limit - used);

    return {
      feature,
      used,
      limit,
      remaining,
      resetsAt: UsageTrackingService.getNextPeriodStart(gate.period),
      periodType: gate.period,
    };
  }

  static async getAllUsage(userId: string): Promise<UsageStatus[]> {
    const features = Object.keys(FEATURE_GATES);
    const { tier } = await SubscriptionQueryService.getSubscriptionInfo(userId);
    const allCounters = await UsageRepository.getCountersForUser(userId);

    return features.map(feature =>
      UsageTrackingService.computeUsageForFeature(feature, tier, allCounters)
    );
  }

  private static computeUsageForFeature(
    feature: string,
    tier: SubscriptionTier,
    allCounters: Array<{
      feature: string;
      period_type: string;
      period_start: string;
      count: number;
    }>
  ): UsageStatus {
    const gate = FEATURE_GATES[feature];
    if (!gate) {
      return {
        feature,
        used: 0,
        limit: null,
        remaining: null,
        resetsAt: new Date().toISOString(),
        periodType: 'daily',
      };
    }

    const limit = getFeatureLimit(feature, tier);
    const periodStart = getPeriodStart(gate.period);

    const counter = allCounters.find(
      c =>
        c.feature === feature &&
        c.period_type === gate.period &&
        c.period_start === periodStart
    );

    const used = counter?.count ?? 0;
    const remaining = limit === null ? null : Math.max(0, limit - used);

    return {
      feature,
      used,
      limit,
      remaining,
      resetsAt: UsageTrackingService.getNextPeriodStart(gate.period),
      periodType: gate.period,
    };
  }

  /**
   * Atomically consume one unit of quota. Check + increment happen in a single
   * DB statement, closing the usage-quota TOCTOU. Counting is at gate time.
   *
   * @param limit already beta/tier-resolved. null = unlimited (still counts).
   * @returns true when within quota (and counted), false when the limit is reached.
   */
  static async consumeQuota(
    userId: string,
    feature: string,
    limit: number | null
  ): Promise<boolean> {
    const gate = FEATURE_GATES[feature];
    if (!gate) {
      logger.warn('Attempted to consume quota for unknown feature', {
        userId,
        feature,
      });
      return true;
    }

    return UsageRepository.checkAndIncrementUsage(
      userId,
      feature,
      gate.period,
      getPeriodStart(gate.period),
      limit
    );
  }

  /** Start of the NEXT period (used as the reset time). */
  private static getNextPeriodStart(periodType: Period): string {
    const now = new Date();

    switch (periodType) {
      case 'daily': {
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(now.getUTCDate() + 1);
        tomorrow.setUTCHours(0, 0, 0, 0);
        return tomorrow.toISOString();
      }
      case 'weekly': {
        const day = now.getUTCDay();
        const diff = day === 0 ? 1 : 8 - day;
        const nextMonday = new Date(now);
        nextMonday.setUTCDate(now.getUTCDate() + diff);
        nextMonday.setUTCHours(0, 0, 0, 0);
        return nextMonday.toISOString();
      }
      case 'monthly': {
        const nextMonth = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
        );
        return nextMonth.toISOString();
      }
    }
  }
}
