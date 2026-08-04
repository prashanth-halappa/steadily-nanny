/**
 * Notification prefs repository — reads/writes `notification_prefs`.
 *
 * @module domains/notification/repositories/notificationPrefsRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

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

const TABLE = 'notification_prefs';

export class NotificationPrefsRepository extends BaseRepository<NotificationPrefsRow> {
  constructor() {
    super(TABLE);
  }

  async findByUserId(userId: string): Promise<NotificationPrefsRow | null> {
    const { data, error } = await supabaseService
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to load notification prefs',
        'NOTIFICATION_PREFS_QUERY_FAILED',
        {
          userId,
          operation: 'findByUserId',
          dbError: error.message,
        }
      );
    }

    return data as NotificationPrefsRow | null;
  }

  async upsert(
    userId: string,
    input: NotificationPrefsUpsert
  ): Promise<NotificationPrefsRow> {
    const { data, error } = await supabaseService
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          disabled_types: input.disabled_types,
          quiet_hours_enabled: input.quiet_hours_enabled,
          quiet_hours_start: input.quiet_hours_start,
          quiet_hours_end: input.quiet_hours_end,
          timezone: input.timezone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      throw new DatabaseError(
        'Failed to upsert notification prefs',
        'NOTIFICATION_PREFS_UPSERT_FAILED',
        {
          userId,
          operation: 'upsert',
          dbError: error.message,
        }
      );
    }

    return data as NotificationPrefsRow;
  }
}
