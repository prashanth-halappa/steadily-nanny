/**
 * Notification domain types.
 *
 * @module domains/notification/types
 */
import type { DELIVERABLE_NOTIFICATION_PERMISSIONS } from '../constants';

/** Notification permission states persisted on a device row. */
export type NotificationPermission = 'granted' | 'provisional' | 'denied';

/** A permission state a device may be pushed to. */
export type DeliverablePermission =
  (typeof DELIVERABLE_NOTIFICATION_PERMISSIONS)[number];

/** Device platforms the client can register from. */
export type DevicePlatform = 'ios' | 'android';

/** A row in the `user_device_info` table. */
export interface DeviceRow {
  id: string;
  user_id: string;
  device_id: string;
  expo_push_token: string | null;
  platform: DevicePlatform | null;
  notification_permission: NotificationPermission;
  timezone: string | null;
  app_version: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields accepted when upserting a device. */
export interface UpsertDeviceInput {
  deviceId: string;
  expoPushToken?: string;
  platform: DevicePlatform;
  notificationPermission: NotificationPermission;
  timezone?: string;
  appVersion?: string;
}

/** The user-facing content of a single push. */
export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Result of a batch send: how many were accepted and which tokens are dead. */
export interface SendResult {
  /** Count of tickets Expo accepted (`status: 'ok'`). */
  sent: number;
  /**
   * Tokens Expo reported as `DeviceNotRegistered` — the caller should clear
   * these so future sends skip them.
   */
  invalidTokens: string[];
}
