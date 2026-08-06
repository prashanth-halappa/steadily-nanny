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
 * Since migration 060 the ledger is two-phase: `claim` writes a reservation,
 * `confirm` promotes it to a recorded delivery, and `sweepStaleClaims` deletes
 * reservations nothing ever confirmed — the residue of a run killed between
 * the claim and the send.
 *
 * @module domains/notification/repositories/reminderLogRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';

const TABLE = 'push_reminder_log';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

/**
 * How long an unconfirmed claim is given before it is treated as garbage from
 * a crashed run (migration 060). A job pass is minutes, so two hours can never
 * sweep a claim out from under the run that is holding it, and a crashed
 * evening's reminders come back on the next hourly run rather than a day
 * later.
 */
const STALE_CLAIM_HOURS = 2;

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

  /**
   * Mark a claim as an actual delivery (migration 060).
   *
   * Until this lands the row is only a reservation, and {@link
   * sweepStaleClaims} is entitled to delete it. Best-effort like
   * {@link release}: a failure here costs at most one duplicate reminder
   * after the sweep, whereas throwing would push a SUCCESSFUL send into the
   * caller's release path and re-send it on the next run for certain.
   */
  async confirm(userId: string, reminderKey: string): Promise<void> {
    const { error } = await supabaseService
      .from(TABLE)
      .update({ confirmed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('reminder_key', reminderKey);

    if (error) {
      logger.error('Failed to confirm push reminder log claim', {
        userId,
        reminderKey,
        operation: 'confirm',
        dbError: error.message,
      });
    }
  }

  /**
   * Delete claims that were never confirmed and are old enough that no live
   * run can still be holding them — the residue of a process killed between
   * the claim commit and the send returning. Each one is a reminder that was
   * never delivered and, without this, never would be.
   *
   * Confirmed rows are the dedupe ledger itself and are never swept; they age
   * out with their subject (a shift reminder's key stops being asked about
   * once the shift is past).
   */
  async sweepStaleClaims(): Promise<void> {
    const cutoff = new Date(
      Date.now() - STALE_CLAIM_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { error } = await supabaseService
      .from(TABLE)
      .delete()
      .is('confirmed_at', null)
      .lt('sent_at', cutoff);

    if (error) {
      logger.error('Failed to sweep stale push reminder claims', {
        operation: 'sweepStaleClaims',
        cutoff,
        dbError: error.message,
      });
    }
  }
}
