/**
 * Subscription repository — reads the subscription mirror and processes webhook
 * events via the hardened `process_subscription_event` RPC.
 *
 * @module domains/subscription/repositories/subscriptionRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';

interface SubscriptionRow {
  id: string;
  user_id: string;
  tier: string;
  product_id: string | null;
  platform: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ProcessEventParams {
  p_event_id: string;
  p_event_type: string;
  p_event_timestamp: string;
  p_user_id: string;
  p_rc_app_user_id: string;
  p_tier: string;
  p_product_id: string;
  p_entitlement_id: string;
  p_platform: string;
  p_store: string;
  p_environment: string;
  p_expires_at: string | null;
  p_payload: Record<string, unknown>;
  p_period_type?: string | null;
  p_is_trial_conversion?: boolean | null;
  p_price?: number | null;
  p_purchased_at?: string | null;
}

export class SubscriptionRepository {
  static async findByUserId(userId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await supabaseService
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find user subscription',
        'DATABASE_ERROR',
        {
          userId,
          operation: 'findByUserId',
          dbError: error.message,
        }
      );
    }

    return (data as SubscriptionRow) ?? null;
  }

  /**
   * Process a subscription event via the RPC. Atomically upserts the mirror row
   * and logs the event. Returns the RPC status: 'processed' | 'duplicate' |
   * 'stale' | 'skipped'.
   */
  static async processEvent(
    params: ProcessEventParams
  ): Promise<{ status: string; event_id: string }> {
    const { data, error } = await supabaseService.rpc(
      'process_subscription_event',
      params
    );

    if (error) {
      throw new DatabaseError(
        'Failed to process subscription event',
        'DATABASE_ERROR',
        {
          eventId: params.p_event_id,
          eventType: params.p_event_type,
          userId: params.p_user_id,
          operation: 'processEvent',
          dbError: error.message,
        }
      );
    }

    return (
      (data as { status: string; event_id: string }) ?? {
        status: 'processed',
        event_id: params.p_event_id,
      }
    );
  }

  /**
   * Upsert a mirror row from a REST /sync fallback. Logs but does not throw on
   * failure — /sync should still return the RC result.
   */
  static async upsertFromSync(
    userId: string,
    tier: string,
    expiresAt: string | null,
    productId: string | null,
    platform: string | null
  ): Promise<void> {
    const { error } = await supabaseService.from('user_subscriptions').upsert(
      {
        user_id: userId,
        revenuecat_app_user_id: userId,
        tier,
        product_id: productId,
        expires_at: expiresAt,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      logger.error('Failed to persist sync result to DB', {
        userId,
        tier,
        dbError: error.message,
      });
    }
  }
}
