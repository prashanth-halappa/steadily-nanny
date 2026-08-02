// File: src/api/endpoints/notifications.ts
// API endpoint for registering/refreshing the caller's push device.

import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const notificationEndpoints = {
  // API-CONTRACT: POST registers/refreshes the caller's device (push, timezone).
  devices: '/v1/notifications/devices',
} as const;

// Device registration payload — validated client-side before the request.
// D21: `.min(1)` on the optional fields mirrors `RegisterDeviceSchema`
// (apps/api/src/domains/notification/schemas.ts) exactly, so an empty
// string fails locally instead of only at the API.
const DeviceRegistrationInputSchema = z.object({
  /** Stable per-install identifier (see getInstallId()). */
  deviceId: z.string().min(1),
  /** Expo push token; absent until notification permission is granted. */
  expoPushToken: z.string().min(1).optional(),
  platform: z.enum(['ios', 'android']),
  // API-CONTRACT: the server accepts only these three permission states (there is
  // no 'undetermined' — a not-yet-granted device maps to 'denied').
  notificationPermission: z.enum(['granted', 'provisional', 'denied']),
  /** IANA timezone, e.g. `America/New_York`. */
  timezone: z.string().min(1).optional(),
  /** App marketing version, e.g. `1.2.0`. */
  appVersion: z.string().min(1).optional(),
});

/** Input accepted by `notificationsApi.registerDevice`. */
export type DeviceRegistrationInput = z.infer<
  typeof DeviceRegistrationInputSchema
>;

export const notificationsApi = {
  /**
   * Register (or refresh) the caller's device for push + timezone tracking.
   * Fire-and-return: the server response body is intentionally ignored.
   * @param info - Device registration details
   */
  registerDevice: async (info: DeviceRegistrationInput): Promise<void> => {
    const validated = DeviceRegistrationInputSchema.safeParse(info);
    if (!validated.success) throw validated.error;
    await apiClient.post(notificationEndpoints.devices, validated.data);
  },
};
