/**
 * Subscription domain errors. Both carry a load-bearing generic ErrorCode that
 * clients key their upsell / limit UI off of.
 *
 * @module domains/subscription/errors/subscriptionErrors
 */
import { BaseError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/** A feature requires a paid subscription (hard paywall). */
export class PaywallRequiredError extends BaseError {
  constructor(feature: string, metadata?: ErrorMetadata) {
    super(
      `Subscription required for ${feature}`,
      'PAYWALL_REQUIRED',
      402,
      true,
      {
        ...metadata,
        feature,
      }
    );
  }
}

interface UsageStatusDetail {
  feature: string;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
  periodType: string;
}

/** The user exceeded their usage quota for a feature. */
export class UsageLimitExceededError extends BaseError {
  public readonly usage: UsageStatusDetail;

  constructor(
    feature: string,
    usage: UsageStatusDetail,
    metadata?: ErrorMetadata
  ) {
    super(
      `Usage limit exceeded for ${feature}: ${usage.used}/${usage.limit}`,
      'USAGE_LIMIT_EXCEEDED',
      429,
      true,
      { ...metadata, feature }
    );
    this.usage = usage;
  }

  public override toJSON() {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        details: this.usage,
      },
      statusCode: this.statusCode,
      isOperational: this.isOperational,
      stack: this.stack,
    };
  }
}
