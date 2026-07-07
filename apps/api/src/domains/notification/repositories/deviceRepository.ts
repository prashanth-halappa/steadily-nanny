/**
 * Device repository — reads/writes the `user_device_info` table.
 *
 * @module domains/notification/repositories/deviceRepository
 */
import { Expo } from 'expo-server-sdk';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { DELIVERABLE_NOTIFICATION_PERMISSIONS } from '../constants';
import type { DeviceRow, UpsertDeviceInput } from '../types';

const TABLE = 'user_device_info';

export class DeviceRepository {
  /**
   * Upsert a device on the unique `(user_id, device_id)` pair. A returning
   * device re-registers (new token/permission/timezone) without creating a
   * duplicate row.
   */
  static async upsertDevice(
    userId: string,
    input: UpsertDeviceInput
  ): Promise<DeviceRow> {
    const { data, error } = await supabaseService
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          device_id: input.deviceId,
          expo_push_token: input.expoPushToken ?? null,
          platform: input.platform,
          notification_permission: input.notificationPermission,
          timezone: input.timezone ?? null,
          app_version: input.appVersion ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,device_id' }
      )
      .select()
      .single();

    if (error) {
      throw new DatabaseError(
        'Failed to upsert device',
        'DEVICE_UPSERT_FAILED',
        {
          userId,
          deviceId: input.deviceId,
          operation: 'upsertDevice',
          dbError: error.message,
        }
      );
    }

    return data as DeviceRow;
  }

  /**
   * Every push token for a user that is currently deliverable — i.e. a non-null
   * token on a device whose permission is in
   * {@link DELIVERABLE_NOTIFICATION_PERMISSIONS} (so provisional devices are
   * NOT dropped). Malformed tokens are filtered out with `Expo.isExpoPushToken`.
   */
  static async getDeliverableTokensForUser(userId: string): Promise<string[]> {
    const { data, error } = await supabaseService
      .from(TABLE)
      .select('expo_push_token')
      .eq('user_id', userId)
      .in('notification_permission', DELIVERABLE_NOTIFICATION_PERMISSIONS)
      .not('expo_push_token', 'is', null);

    if (error) {
      throw new DatabaseError(
        'Failed to load deliverable tokens',
        'DEVICE_TOKEN_QUERY_FAILED',
        {
          userId,
          operation: 'getDeliverableTokensForUser',
          dbError: error.message,
        }
      );
    }

    return (data ?? [])
      .map(row => row.expo_push_token as string | null)
      .filter(
        (token): token is string => !!token && Expo.isExpoPushToken(token)
      );
  }

  /**
   * Clear tokens Expo reported as `DeviceNotRegistered`. The device rows are
   * kept (a re-register will repopulate the token), but their `expo_push_token`
   * is nulled so future sends skip them. No-op on an empty list.
   */
  static async removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    const { error } = await supabaseService
      .from(TABLE)
      .update({ expo_push_token: null, updated_at: new Date().toISOString() })
      .in('expo_push_token', tokens);

    if (error) {
      // Cleanup is best-effort — log rather than throw so a send still succeeds.
      logger.error('Failed to clear invalid push tokens', {
        count: tokens.length,
        error: error.message,
      });
    }
  }
}
