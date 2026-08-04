// File: src/api/endpoints/notifications.ts
// API endpoints for device registration and notification preferences.

import {
  NotificationPrefsSchema,
  type UpdateNotificationPrefsInput,
  UpdateNotificationPrefsSchema,
} from '@steadily-nanny/shared-types';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const notificationEndpoints = {
  // API-CONTRACT: POST registers/refreshes the caller's device (push, timezone).
  devices: '/v1/notifications/devices',
  // API-CONTRACT: GET/PATCH per-user push prefs (opt-outs + quiet hours).
  prefs: '/v1/notifications/prefs',
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

// API-CONTRACT: GET/PATCH `/v1/notifications/prefs` returns `{ prefs }` in data.
const PrefsEnvelopeSchema = z.object({
  prefs: NotificationPrefsSchema,
});

export type { UpdateNotificationPrefsInput };

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

  /** GET /v1/notifications/prefs — defaults when no row exists. */
  getPrefs: async () => {
    const response = await apiClient.get(notificationEndpoints.prefs);
    const parsed = PrefsEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.prefs;
  },

  /** PATCH /v1/notifications/prefs — partial upsert. */
  updatePrefs: async (input: UpdateNotificationPrefsInput) => {
    const validated = UpdateNotificationPrefsSchema.safeParse(input);
    if (!validated.success) throw validated.error;
    const response = await apiClient.patch(
      notificationEndpoints.prefs,
      validated.data
    );
    const parsed = PrefsEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.prefs;
  },
};
