/**
 * Email log repository — data access for the `email_log` table.
 *
 * Tracks every send for idempotency (dedupe) and the per-user daily cap.
 *
 * @module domains/email/repositories/emailLogRepository
 */

import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import type { EmailLog, LogSendParams } from '../types';

const TABLE = 'email_log';

export class EmailLogRepository {
  /**
   * Record a send. `dedupe_key` is unique when non-null, so a duplicate insert
   * is a real (unique-violation) error — callers should check
   * {@link wasRecentlySent} first.
   */
  static async logSend(params: LogSendParams): Promise<EmailLog> {
    const { data, error } = await supabaseService
      .from(TABLE)
      .insert({
        user_id: params.userId ?? null,
        email_type: params.emailType,
        recipient: params.recipient,
        status: params.status,
        dedupe_key: params.dedupeKey ?? null,
        metadata: params.metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      throw new DatabaseError(
        'Failed to log email send',
        'EMAIL_LOG_INSERT_FAILED',
        {
          emailType: params.emailType,
          operation: 'logSend',
          dbError: error.message,
        }
      );
    }

    return data as EmailLog;
  }

  /**
   * Whether a non-null `dedupe_key` has already been recorded. Used for
   * idempotency before sending. Returns `false` (allow send) on query error so a
   * transient DB blip does not silently drop a legitimate email.
   */
  static async wasRecentlySent(dedupeKey: string): Promise<boolean> {
    const { data, error } = await supabaseService
      .from(TABLE)
      .select('id')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();

    if (error) {
      logger.error('Failed to check email dedupe key', {
        dedupeKey,
        error: error.message,
      });
      return false;
    }

    return !!data;
  }

  /**
   * Count emails sent to a user today (UTC day) — used to enforce the daily cap.
   * Failed sends do not count. Returns 0 on error to avoid blocking sends.
   */
  static async countSentToday(userId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count, error } = await supabaseService
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('status', 'failed')
      .gte('sent_at', todayStart.toISOString());

    if (error) {
      logger.error('Failed to count emails sent today', {
        userId,
        error: error.message,
      });
      return 0;
    }

    return count ?? 0;
  }
}
