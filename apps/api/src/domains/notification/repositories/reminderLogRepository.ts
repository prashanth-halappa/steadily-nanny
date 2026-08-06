/**
 * Push reminder idempotency ledger — `push_reminder_log` (migration 047).
 *
 * The reminders job INSERTs a row BEFORE sending (guards overlapping/repeated
 * runs); if the send then turns out not to have actually delivered anything
 * (Expo rejected every ticket, or the send threw), the job calls `release` to
 * delete the claim so a later run gets another attempt instead of the
 * reminder being silently dropped forever. A unique violation on the claim
 * insert means "already sent" and is not an error.
 *
 * @module domains/notification/repositories/reminderLogRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';

const TABLE = 'push_reminder_log';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

export class ReminderLogRepository {
  /**
   * Attempt to claim a reminder send slot for `(userId, reminderKey)`.
   *
   * @returns `true` when the insert won (caller should send); `false` when the
   *   row already exists (skip silently).
   */
  async claim(userId: string, reminderKey: string): Promise<boolean> {
    const { error } = await supabaseService.from(TABLE).insert({
      user_id: userId,
      reminder_key: reminderKey,
    });

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return false;
      }
      throw new DatabaseError(
        'Failed to claim push reminder log row',
        'PUSH_REMINDER_LOG_INSERT_FAILED',
        {
          userId,
          reminderKey,
          operation: 'claim',
          dbError: error.message,
          code: error.code,
        }
      );
    }

    return true;
  }

  /**
   * Release a claimed slot after a send that turned out not to deliver
   * anything, so the next run retries instead of the reminder being
   * permanently suppressed by a claim row nothing was ever sent for.
   *
   * Best-effort like {@link DeviceRepository.removeTokens}: a delete failure
   * is logged, not thrown, so it can't mask the send failure that triggered
   * the release. If the delete itself fails, that one slot stays claimed
   * until the row is cleaned up out of band — narrower than the bug this
   * exists to fix, since it only bites on a second, independent DB failure.
   */
  async release(userId: string, reminderKey: string): Promise<void> {
    const { error } = await supabaseService
      .from(TABLE)
      .delete()
      .eq('user_id', userId)
      .eq('reminder_key', reminderKey);

    if (error) {
      logger.error('Failed to release push reminder log claim', {
        userId,
        reminderKey,
        operation: 'release',
        dbError: error.message,
      });
    }
  }
}
