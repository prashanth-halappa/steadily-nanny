/**
 * Push reminder idempotency ledger — `push_reminder_log` (migration 047).
 *
 * The reminders job INSERTs a row BEFORE sending; a unique violation on
 * `(user_id, reminder_key)` means "already sent" and is not an error.
 *
 * @module domains/notification/repositories/reminderLogRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

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
}
