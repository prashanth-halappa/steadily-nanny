/**
 * Notification prefs repository — reads/writes `notification_prefs`.
 *
 * @module domains/notification/repositories/notificationPrefsRepository
 */
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { notificationPrefs } from '../../../db/schema';
import { DatabaseError } from '../../../errors';

export interface NotificationPrefsRow {
  user_id: string;
  disabled_types: string[];
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export type NotificationPrefsUpsert = {
  disabled_types: string[];
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
};

const errMsg = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Not a BaseRepository: the table is keyed by `user_id` (no `id` column), and
 * nothing ever called the inherited id-keyed helpers.
 */
export class NotificationPrefsRepository {
  async findByUserId(userId: string): Promise<NotificationPrefsRow | null> {
    try {
      const [row] = await db
        .select()
        .from(notificationPrefs)
        .where(eq(notificationPrefs.user_id, userId))
        .limit(1);
      return row ?? null;
    } catch (err) {
      throw new DatabaseError(
        'Failed to load notification prefs',
        'NOTIFICATION_PREFS_QUERY_FAILED',
        { userId, operation: 'findByUserId', dbError: errMsg(err) }
      );
    }
  }

  async upsert(
    userId: string,
    input: NotificationPrefsUpsert
  ): Promise<NotificationPrefsRow> {
    const row = {
      disabled_types: input.disabled_types,
      quiet_hours_enabled: input.quiet_hours_enabled,
      quiet_hours_start: input.quiet_hours_start,
      quiet_hours_end: input.quiet_hours_end,
      timezone: input.timezone,
      updated_at: new Date().toISOString(),
    };
    try {
      const [data] = await db
        .insert(notificationPrefs)
        .values({ user_id: userId, ...row })
        .onConflictDoUpdate({ target: notificationPrefs.user_id, set: row })
        .returning();
      return data as NotificationPrefsRow;
    } catch (err) {
      throw new DatabaseError(
        'Failed to upsert notification prefs',
        'NOTIFICATION_PREFS_UPSERT_FAILED',
        { userId, operation: 'upsert', dbError: errMsg(err) }
      );
    }
  }
}
