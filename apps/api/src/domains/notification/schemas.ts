/**
 * Notification request schemas (Zod).
 *
 * @module domains/notification/schemas
 */
import { z } from 'zod';

/**
 * Body for `POST /api/v1/notifications/devices`. The mobile client registers /
 * refreshes its device row here right AFTER the user profile is created (see
 * `deviceRegistrationService.registerDevice` for the FK-ordering note).
 */
export const RegisterDeviceSchema = z.object({
  /** Stable per-install device identifier (client-generated UUID). */
  deviceId: z.string().min(1),
  /** Expo push token — optional (a device may register before granting push). */
  expoPushToken: z.string().min(1).optional(),
  /** Device platform. */
  platform: z.enum(['ios', 'android']),
  /** Current OS push permission for this device. */
  notificationPermission: z.enum(['granted', 'provisional', 'denied']),
  /** IANA timezone (e.g. `America/Los_Angeles`) for send-time scheduling. */
  timezone: z.string().min(1).optional(),
  /** Client app version (for debugging / targeting). */
  appVersion: z.string().min(1).optional(),
});

/** Validated body of a device-registration request. */
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>;
