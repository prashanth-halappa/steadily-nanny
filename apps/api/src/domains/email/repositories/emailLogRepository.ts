/**
 * Email log repository — data access for the `email_log` table.
 *
 * Tracks every send for idempotency (dedupe) and the per-user daily cap.
 *
 * @module domains/email/repositories/emailLogRepository
 */
import { and, count, eq, gte, ne } from 'drizzle-orm';
import { db } from '../../../db/client';
import { emailLog } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import type { EmailLog, LogSendParams } from '../types';

const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export class EmailLogRepository {
  /**
   * Record a send. `dedupe_key` is unique when non-null, so a duplicate insert
   * is a real (unique-violation) error — callers should check
   * {@link wasRecentlySent} first.
   */
  static async logSend(params: LogSendParams): Promise<EmailLog> {
    try {
      const [data] = await db
        .insert(emailLog)
        .values({
          user_id: params.userId ?? null,
          email_type: params.emailType,
          recipient: params.recipient,
          status: params.status,
          dedupe_key: params.dedupeKey ?? null,
          metadata: params.metadata ?? {},
        })
        .returning();
      return data as EmailLog;
    } catch (err) {
      throw new DatabaseError(
        'Failed to log email send',
        'EMAIL_LOG_INSERT_FAILED',
        {
          emailType: params.emailType,
          operation: 'logSend',
          dbError: errMsg(err),
        }
      );
    }
  }

  /**
   * Whether a non-null `dedupe_key` has already been recorded. Used for
   * idempotency before sending. Returns `false` (allow send) on query error so a
   * transient DB blip does not silently drop a legitimate email.
   */
  static async wasRecentlySent(dedupeKey: string): Promise<boolean> {
    try {
      const rows = await db
        .select({ id: emailLog.id })
        .from(emailLog)
        .where(eq(emailLog.dedupe_key, dedupeKey))
        .limit(1);
      return rows.length > 0;
    } catch (err) {
      logger.error('Failed to check email dedupe key', {
        dedupeKey,
        error: errMsg(err),
      });
      return false;
    }
  }

  /**
   * Count emails sent to a user today (UTC day) — used to enforce the daily cap.
   * Failed sends do not count. Returns 0 on error to avoid blocking sends.
   */
  static async countSentToday(userId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    try {
      const [row] = await db
        .select({ n: count() })
        .from(emailLog)
        .where(
          and(
            eq(emailLog.user_id, userId),
            ne(emailLog.status, 'failed'),
            gte(emailLog.sent_at, todayStart.toISOString())
          )
        );
      return row?.n ?? 0;
    } catch (err) {
      logger.error('Failed to count emails sent today', {
        userId,
        error: errMsg(err),
      });
      return 0;
    }
  }
}
