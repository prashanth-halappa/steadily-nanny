/**
 * Device registration service.
 *
 * Validates a registration payload and upserts the device row. Called by the
 * mobile client right AFTER the user profile is created.
 *
 * FK-ORDERING: `user_device_info.user_id` references `user_profiles`, so the
 * profile row MUST exist before the first device registration — otherwise the
 * insert fails the foreign key. Register the device in the profile-creation
 * success path, not before it.
 *
 * @module domains/notification/services/deviceRegistrationService
 */
import { logger } from '../../../middlewares/logger';
import { DeviceRepository } from '../repositories/deviceRepository';
import type { RegisterDeviceInput } from '../schemas';
import type { DeviceRow } from '../types';

/**
 * Register (or refresh) a device for a user. Returns the persisted row.
 *
 * @param userId - The authenticated user's id.
 * @param input - The validated {@link RegisterDeviceInput}.
 */
export async function registerDevice(
  userId: string,
  input: RegisterDeviceInput
): Promise<DeviceRow> {
  const device = await DeviceRepository.upsertDevice(userId, {
    deviceId: input.deviceId,
    expoPushToken: input.expoPushToken,
    platform: input.platform,
    notificationPermission: input.notificationPermission,
    timezone: input.timezone,
    appVersion: input.appVersion,
  });

  logger.info('Device registered', {
    userId,
    deviceId: input.deviceId,
    platform: input.platform,
    notificationPermission: input.notificationPermission,
  });

  return device;
}
