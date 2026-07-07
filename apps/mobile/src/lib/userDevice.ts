/**
 * Device registration.
 *
 * Builds this install's device fingerprint (stable install id, timezone, Expo
 * push token, OS permission) and upserts it via the API device endpoint.
 *
 * GOLDEN (FK ordering): registration goes through `notificationsApi.registerDevice`,
 * NOT a direct DB write, and must be called AFTER the user profile row exists (the
 * shell calls it from profile-creation `onSuccess`). A device row keyed to a
 * not-yet-created user would FK-fail silently and leave the device (and its
 * timezone) unregistered.
 */

import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { getCalendars } from 'expo-localization';
import { Platform } from 'react-native';
import type { DeviceRegistrationInput } from '@/src/api/endpoints/notifications';
import { notificationsApi } from '@/src/api/endpoints/notifications';
import { storage } from '@/src/lib/mmkvStorage';
import {
  getExpoPushToken,
  getUserNotificationPermissions,
} from './pushNotification';

const INSTALLATION_ID_KEY = 'device.installation_id';

const NOTIFICATION_PERMISSIONS = ['granted', 'provisional', 'denied'] as const;

type NotificationPermission = DeviceRegistrationInput['notificationPermission'];

/**
 * Coerce the raw OS permission into the API's enum. The server has no
 * 'undetermined' state, so anything not granted/provisional maps to 'denied'.
 */
function toNotificationPermission(raw: string | null): NotificationPermission {
  return (NOTIFICATION_PERMISSIONS as readonly string[]).includes(raw ?? '')
    ? (raw as NotificationPermission)
    : 'denied';
}

/**
 * Stable per-install identifier.
 *
 * GOLDEN: prefers the OS vendor/device id, but falls back to a persisted UUID
 * when the OS id is null — notably the iOS Simulator, where
 * `getIosIdForVendorAsync()` returns null. Without this fallback a NOT NULL
 * install-id constraint would reject the upsert and the device (and its
 * timezone) would never register.
 */
export async function getInstallId(): Promise<string> {
  let osId: string | null = null;
  if (Platform.OS === 'ios') {
    osId = await Application.getIosIdForVendorAsync();
  } else if (Platform.OS === 'android') {
    osId = Application.getAndroidId();
  }
  if (osId) {
    return osId;
  }

  let fallback = storage.getString(INSTALLATION_ID_KEY);
  if (!fallback) {
    fallback = Crypto.randomUUID();
    storage.set(INSTALLATION_ID_KEY, fallback);
  }
  return fallback;
}

/**
 * Upserts this device with the backend via the API.
 *
 * The API infers the user from the auth token and handles stale-token
 * deactivation server-side (an older install id with the same push token is
 * deactivated), so this never writes to the DB directly.
 */
export async function registerDeviceWithBackend(): Promise<void> {
  const appInstallationId = await getInstallId();
  const expoPushToken = await getExpoPushToken();
  const notificationPermission = await getUserNotificationPermissions();

  // GOLDEN: capture the device's IANA timezone (e.g. "America/Los_Angeles") so
  // the server can compute the user's local day boundaries.
  const calendars = getCalendars();
  const timezone = calendars[0]?.timeZone ?? 'UTC';

  const info: DeviceRegistrationInput = {
    deviceId: appInstallationId,
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    notificationPermission: toNotificationPermission(notificationPermission),
    timezone,
    ...(Application.nativeApplicationVersion
      ? { appVersion: Application.nativeApplicationVersion }
      : {}),
    ...(expoPushToken ? { expoPushToken } : {}),
  };

  await notificationsApi.registerDevice(info);
}
