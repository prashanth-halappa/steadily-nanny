/**
 * Per-user push preference wire contract: event-type opt-outs + quiet hours.
 *
 * Missing prefs row = all types enabled, quiet hours off (backward compatible).
 * Delivery gating lives in the API push chokepoint (`sendToUser`).
 *
 * @module packages/shared-types/src/schemas/notificationPrefs.schema
 */

import { z } from 'zod';
import { PushNotificationTypeSchema } from './notification.schema';

/** Local wall-clock time as `HH:mm` (24h). */
export const QuietHoursTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:mm');

/**
 * Whether `value` is a real IANA time zone identifier (e.g. `Europe/London`).
 * Rejects raw UTC offsets (`+01:00`) that `Intl` would otherwise accept.
 * Same gate as the user-profile timezone field — aliases resolve via Intl.
 */
export function isValidIanaTimeZone(value: string): boolean {
  if (value.startsWith('+') || value.startsWith('-')) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const IanaTimeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isValidIanaTimeZone, {
    message: 'timezone must be a valid IANA time zone identifier',
  });

/**
 * Persisted / API response shape for a user's notification preferences.
 * `disabledTypes` is an opt-out list — absent types are delivered.
 */
export const NotificationPrefsSchema = z.object({
  disabledTypes: z.array(PushNotificationTypeSchema),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: QuietHoursTimeSchema.nullable(),
  quietHoursEnd: QuietHoursTimeSchema.nullable(),
  /** IANA zone used when evaluating quiet hours. */
  timezone: IanaTimeZoneSchema,
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

/**
 * PATCH body — any subset. Enabling quiet hours requires both start and end
 * either in this patch or already stored (enforced in the prefs service).
 */
export const UpdateNotificationPrefsSchema = z
  .object({
    disabledTypes: z.array(PushNotificationTypeSchema).optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: QuietHoursTimeSchema.nullable().optional(),
    quietHoursEnd: QuietHoursTimeSchema.nullable().optional(),
    timezone: IanaTimeZoneSchema.optional(),
  })
  .refine(
    data => Object.keys(data).length > 0,
    'at least one preference field is required'
  );
export type UpdateNotificationPrefsInput = z.infer<
  typeof UpdateNotificationPrefsSchema
>;

/** Defaults when no prefs row exists. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  disabledTypes: [],
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone: 'UTC',
};
