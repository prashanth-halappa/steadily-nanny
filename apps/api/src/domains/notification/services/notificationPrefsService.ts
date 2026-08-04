/**
 * Notification preference service — get/update prefs and decide whether a
 * push should be delivered for a given user + payload.
 *
 * Missing prefs = all enabled / quiet hours off. Prefs lookup failures
 * fail-open (deliver) so a DB blip cannot mute every push.
 *
 * @module domains/notification/services/notificationPrefsService
 */
import {
  DEFAULT_NOTIFICATION_PREFS,
  isValidIanaTimeZone,
  type NotificationPrefs,
  type PushNotificationType,
  PushNotificationTypeSchema,
  type UpdateNotificationPrefsInput,
} from '@steadily-nanny/shared-types';
import { ValidationError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import { QUIET_HOURS_EXEMPT_TYPES } from '../constants';
import {
  NotificationPrefsRepository,
  type NotificationPrefsRow,
} from '../repositories/notificationPrefsRepository';
import type { PushPayload } from '../types';
import { isWithinQuietHours, toHhMm } from './quietHours';

function rowToPrefs(row: NotificationPrefsRow): NotificationPrefs {
  const disabledTypes = row.disabled_types.flatMap(type => {
    const parsed = PushNotificationTypeSchema.safeParse(type);
    return parsed.success ? [parsed.data] : [];
  });

  return {
    disabledTypes,
    quietHoursEnabled: row.quiet_hours_enabled,
    quietHoursStart: row.quiet_hours_start
      ? toHhMm(row.quiet_hours_start)
      : null,
    quietHoursEnd: row.quiet_hours_end ? toHhMm(row.quiet_hours_end) : null,
    timezone: row.timezone || 'UTC',
  };
}

/** Load prefs for a user, or the all-enabled default when no row exists. */
export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  const row = await new NotificationPrefsRepository().findByUserId(userId);
  if (!row) {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
  return rowToPrefs(row);
}

/**
 * Merge a partial update onto current prefs (or defaults) and upsert.
 * Enabling quiet hours without both endpoints is rejected.
 * Invalid IANA timezones are rejected with 400 (Zod also gates the route).
 */
export async function updatePrefs(
  userId: string,
  input: UpdateNotificationPrefsInput
): Promise<NotificationPrefs> {
  if (input.timezone !== undefined && !isValidIanaTimeZone(input.timezone)) {
    throw new ValidationError(
      'timezone must be a valid IANA time zone identifier',
      'NOTIFICATION_PREFS_INVALID_TIMEZONE',
      400
    );
  }

  const current = await getPrefs(userId);

  const next: NotificationPrefs = {
    disabledTypes: input.disabledTypes ?? current.disabledTypes,
    quietHoursEnabled: input.quietHoursEnabled ?? current.quietHoursEnabled,
    quietHoursStart:
      input.quietHoursStart !== undefined
        ? input.quietHoursStart
        : current.quietHoursStart,
    quietHoursEnd:
      input.quietHoursEnd !== undefined
        ? input.quietHoursEnd
        : current.quietHoursEnd,
    timezone: input.timezone ?? current.timezone,
  };

  if (
    next.quietHoursEnabled &&
    (next.quietHoursStart === null || next.quietHoursEnd === null)
  ) {
    throw new ValidationError(
      'quietHoursStart and quietHoursEnd are required when quiet hours are enabled',
      'NOTIFICATION_PREFS_QUIET_HOURS_INCOMPLETE',
      400
    );
  }

  // When quiet hours are disabled, start/end may still be stored so re-enabling
  // restores the last window; delivery ignores them while disabled.
  const row = await new NotificationPrefsRepository().upsert(userId, {
    disabled_types: next.disabledTypes,
    quiet_hours_enabled: next.quietHoursEnabled,
    quiet_hours_start: next.quietHoursStart,
    quiet_hours_end: next.quietHoursEnd,
    timezone: next.timezone,
  });

  return rowToPrefs(row);
}

/**
 * Whether `sendToUser` should attempt Expo delivery for this payload.
 * Fail-open on prefs errors and on invalid quiet-hours timezones. Unknown /
 * missing `data.type` is treated as enabled (cannot match an opt-out).
 * Deadline-bearing types in `QUIET_HOURS_EXEMPT_TYPES` still deliver during
 * quiet hours (opt-out still wins).
 */
export async function shouldDeliverPush(
  userId: string,
  payload: PushPayload,
  now: Date = new Date()
): Promise<boolean> {
  let prefs: NotificationPrefs;
  try {
    prefs = await getPrefs(userId);
  } catch (error) {
    logger.error('Failed to load notification prefs; delivering push', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  const eventType = payload.data?.type;
  if (
    typeof eventType === 'string' &&
    prefs.disabledTypes.includes(eventType as PushNotificationType)
  ) {
    return false;
  }

  if (
    !prefs.quietHoursEnabled ||
    !prefs.quietHoursStart ||
    !prefs.quietHoursEnd
  ) {
    return true;
  }

  let inQuietHours: boolean;
  try {
    if (!isValidIanaTimeZone(prefs.timezone)) {
      logger.warn(
        'Invalid notification prefs timezone; delivering push (fail-open)',
        { userId, timezone: prefs.timezone, type: eventType }
      );
      return true;
    }
    inQuietHours = isWithinQuietHours(
      now,
      prefs.quietHoursStart,
      prefs.quietHoursEnd,
      prefs.timezone
    );
  } catch (error) {
    logger.warn('Quiet-hours evaluation failed; delivering push (fail-open)', {
      userId,
      timezone: prefs.timezone,
      type: eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  if (!inQuietHours) {
    return true;
  }

  const type =
    typeof eventType === 'string'
      ? (eventType as PushNotificationType)
      : undefined;
  const exempt = type !== undefined && QUIET_HOURS_EXEMPT_TYPES.has(type);

  if (exempt) {
    logger.info('Quiet hours active but push type is exempt; delivering', {
      userId,
      type,
      timezone: prefs.timezone,
      quietHoursStart: prefs.quietHoursStart,
      quietHoursEnd: prefs.quietHoursEnd,
    });
    return true;
  }

  logger.info('Suppressing push during quiet hours', {
    userId,
    type: eventType,
    timezone: prefs.timezone,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
  });
  return false;
}
