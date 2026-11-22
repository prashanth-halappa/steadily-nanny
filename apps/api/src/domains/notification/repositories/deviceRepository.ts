/**
 * Device repository — reads/writes the `user_device_info` table.
 *
 * @module domains/notification/repositories/deviceRepository
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { chunk } from '../../../db/chunk';
import { db } from '../../../db/client';
import { userDeviceInfo } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { DELIVERABLE_NOTIFICATION_PERMISSIONS } from '../constants';
import type { DeviceRow, UpsertDeviceInput } from '../types';
import { isExpoPushToken } from '../utils/expoPush';

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
    const row = {
      user_id: userId,
      device_id: input.deviceId,
      expo_push_token: input.expoPushToken ?? null,
      platform: input.platform,
      notification_permission: input.notificationPermission,
      timezone: input.timezone ?? null,
      app_version: input.appVersion ?? null,
      updated_at: new Date().toISOString(),
    };
    try {
      const [data] = await db
        .insert(userDeviceInfo)
        .values(row)
        .onConflictDoUpdate({
          target: [userDeviceInfo.user_id, userDeviceInfo.device_id],
          set: row,
        })
        .returning();
      return data as DeviceRow;
    } catch (err) {
      throw new DatabaseError(
        'Failed to upsert device',
        'DEVICE_UPSERT_FAILED',
        {
          userId,
          deviceId: input.deviceId,
          operation: 'upsertDevice',
          dbError: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  /**
   * Every push token for a user that is currently deliverable — i.e. a non-null
   * token on a device whose permission is in
   * {@link DELIVERABLE_NOTIFICATION_PERMISSIONS} (so provisional devices are
   * NOT dropped). Malformed tokens are filtered out with `isExpoPushToken`.
   */
  static async getDeliverableTokensForUser(userId: string): Promise<string[]> {
    let data: { expo_push_token: string | null }[];
    try {
      data = await db
        .select({ expo_push_token: userDeviceInfo.expo_push_token })
        .from(userDeviceInfo)
        .where(
          and(
            eq(userDeviceInfo.user_id, userId),
            inArray(userDeviceInfo.notification_permission, [
              ...DELIVERABLE_NOTIFICATION_PERMISSIONS,
            ]),
            isNotNull(userDeviceInfo.expo_push_token)
          )
        );
    } catch (err) {
      throw new DatabaseError(
        'Failed to load deliverable tokens',
        'DEVICE_TOKEN_QUERY_FAILED',
        {
          userId,
          operation: 'getDeliverableTokensForUser',
          dbError: err instanceof Error ? err.message : String(err),
        }
      );
    }

    return data
      .map(row => row.expo_push_token)
      .filter((token): token is string => !!token && isExpoPushToken(token));
  }

  /**
   * Clear tokens Expo reported as `DeviceNotRegistered`. The device rows are
   * kept (a re-register will repopulate the token), but their `expo_push_token`
   * is nulled so future sends skip them. No-op on an empty list.
   */
  static async removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    try {
      const updated_at = new Date().toISOString();
      for (const page of chunk(tokens)) {
        await db
          .update(userDeviceInfo)
          .set({ expo_push_token: null, updated_at })
          .where(inArray(userDeviceInfo.expo_push_token, page));
      }
    } catch (err) {
      // Cleanup is best-effort — log rather than throw so a send still succeeds.
      logger.error('Failed to clear invalid push tokens', {
        count: tokens.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
