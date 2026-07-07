/**
 * Subscription command service — processes RevenueCat webhook events, delegating
 * the atomic upsert + event log to the `process_subscription_event` RPC.
 *
 * @module domains/subscription/services/subscriptionCommandService
 */
import { ENTITLEMENT_TIER_MAP } from '@yourapp/shared-types';
import { logger } from '../../../middlewares/logger';
import { SubscriptionRepository } from '../repositories/subscriptionRepository';
import type { RevenueCatWebhookPayload } from '../types';

/**
 * RFC 4122 UUID matcher. RevenueCat sends `app_user_id` as the Supabase user
 * UUID for logged-in users, but anonymous ids (`$RCAnonymousID:...`) are not
 * UUIDs. The RPC casts p_user_id to uuid, so a non-UUID would throw before the
 * body runs — skip those events up-front.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Event types that carry no entitlement and must NOT mutate tier (they omit
 * entitlement_ids); processing them could wrongly downgrade a paying user.
 */
const TIER_NEUTRAL_EVENT_TYPES = new Set([
  'TEST',
  'EXPERIMENT_ENROLLMENT',
  'VIRTUAL_CURRENCY_TRANSACTION',
  'INVOICE_ISSUANCE',
]);

export class SubscriptionCommandService {
  static async processWebhookEvent(
    payload: RevenueCatWebhookPayload
  ): Promise<{ status: string }> {
    const { event } = payload;

    if (!UUID_REGEX.test(event.app_user_id)) {
      logger.warn('Subscription webhook skipped — non-UUID app_user_id', {
        eventId: event.id,
        eventType: event.type,
        appUserId: event.app_user_id,
      });
      return { status: 'skipped' };
    }

    if (TIER_NEUTRAL_EVENT_TYPES.has(event.type)) {
      logger.info('Subscription webhook skipped — tier-neutral event', {
        eventId: event.id,
        eventType: event.type,
      });
      return { status: 'skipped' };
    }

    const tier = SubscriptionCommandService.resolveTier(event.entitlement_ids);
    const expiresAt = event.expiration_at_ms
      ? new Date(event.expiration_at_ms).toISOString()
      : null;

    if (event.type === 'BILLING_ISSUE') {
      logger.warn('Billing issue — user retains access during grace period', {
        eventId: event.id,
        userId: event.app_user_id,
      });
    }

    const eventTimestamp = event.event_timestamp_ms
      ? new Date(event.event_timestamp_ms).toISOString()
      : new Date().toISOString();
    const purchasedAt = event.purchased_at_ms
      ? new Date(event.purchased_at_ms).toISOString()
      : null;

    const result = await SubscriptionRepository.processEvent({
      p_event_id: event.id,
      p_event_type: event.type,
      p_event_timestamp: eventTimestamp,
      p_user_id: event.app_user_id,
      p_rc_app_user_id: event.app_user_id,
      p_tier: tier,
      p_product_id: event.product_id,
      p_entitlement_id: event.entitlement_ids?.[0] ?? '',
      p_platform: event.store,
      p_store: event.store,
      p_environment: event.environment,
      p_expires_at: expiresAt,
      p_payload: payload as unknown as Record<string, unknown>,
      p_period_type: event.period_type ?? null,
      p_is_trial_conversion: event.is_trial_conversion ?? null,
      p_price: event.price ?? null,
      p_purchased_at: purchasedAt,
    });

    const logLevel =
      result.status === 'stale' || result.status === 'skipped'
        ? 'warn'
        : 'info';
    logger[logLevel](`Webhook event ${result.status}`, {
      eventId: event.id,
      eventType: event.type,
      userId: event.app_user_id,
      tier,
      rpcStatus: result.status,
    });

    return { status: result.status };
  }

  /** Resolve tier from entitlement ids via ENTITLEMENT_TIER_MAP; default free. */
  private static resolveTier(
    entitlementIds: readonly string[] | null | undefined
  ): string {
    for (const entitlementId of entitlementIds ?? []) {
      const tier =
        ENTITLEMENT_TIER_MAP[
          entitlementId as keyof typeof ENTITLEMENT_TIER_MAP
        ];
      if (tier) {
        return tier;
      }
    }
    return 'free';
  }
}
