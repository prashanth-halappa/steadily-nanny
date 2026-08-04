/**
 * @module domains/today/hooks/useClockOutReminder
 *
 * Schedules the local "still on the clock?" notification for a running entry
 * and cancels it the moment there isn't one (Daylight UX #7). The card's own
 * overdue state (`clockOutReminder.isOverdue`) only helps someone already
 * looking at the app; this is the half that reaches a carer whose phone is in
 * her pocket on the way home.
 *
 * Re-arms on every mount rather than firing once at clock-in, so a reminder
 * lost to a reinstall, a cleared notification, or a killed process comes
 * back the next time Today is opened — and Today is where clocking in
 * happens, so the first arming is guaranteed.
 *
 * Identified by `data.type` rather than a stored identifier: at most one
 * entry can run per carer, so "cancel every reminder we scheduled" is
 * exactly right, and it needs no persistence that could itself go stale.
 *
 * Silent when notification permission was never granted — the reminder is an
 * extra, and the card state still covers the in-app case. Never prompts:
 * that conversation belongs to `registerForPushNotificationsAsync`, not to
 * someone mid-clock-in.
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getUserNotificationPermissions } from '@/src/lib/pushNotification';
import { resolveOverdueAtMs } from '../utils/clockOutReminder';

const REMINDER_TYPE = PUSH_NOTIFICATION_TYPES.CLOCK_OUT_REMINDER;

const ALLOWED_PERMISSIONS = new Set(['granted', 'provisional']);

/** Cancel every reminder this hook has scheduled, on any device state. */
async function cancelScheduledReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(item => item.content.data?.type === REMINDER_TYPE)
      .map(item =>
        Notifications.cancelScheduledNotificationAsync(item.identifier)
      )
  );
}

interface ClockOutReminderArgs {
  /** The running entry's clock-in instant, or null when not on the clock. */
  clockInAt: string | null;
  /** The matched shift's scheduled finish, when clock-in matched one. */
  shiftEndsAt: string | null;
  title: string;
  body: string;
}

async function armReminder({
  clockInAt,
  shiftEndsAt,
  title,
  body,
}: ClockOutReminderArgs): Promise<void> {
  await cancelScheduledReminders();
  if (!clockInAt) return;

  const permission = await getUserNotificationPermissions();
  if (!permission || !ALLOWED_PERMISSIONS.has(permission)) return;

  const overdueAtMs = resolveOverdueAtMs(clockInAt, shiftEndsAt);
  const secondsFromNow = Math.ceil((overdueAtMs - Date.now()) / 1000);
  // Already past — the card is showing its overdue state right now, so a
  // notification would only repeat what's on screen.
  if (secondsFromNow <= 0) return;

  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { type: REMINDER_TYPE } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsFromNow,
    },
  });
}

/**
 * @param clockInAt the running entry's clock-in instant, or null when the
 *   carer is not on the clock (which cancels any armed reminder).
 * @param shiftEndsAt the matched shift's scheduled finish, or null.
 */
export function useClockOutReminder(
  clockInAt: string | null,
  shiftEndsAt: string | null
): void {
  const { t } = useTranslation('today');

  useEffect(() => {
    armReminder({
      clockInAt,
      shiftEndsAt,
      title: t('stillOnTheClockTitle'),
      body: t('stillOnTheClockBody'),
    }).catch(() => {
      // Notification scheduling is best-effort: a simulator without the
      // entitlement, a revoked permission, or a native failure must never
      // break clocking in. The overdue card state is the guarantee.
    });
  }, [clockInAt, shiftEndsAt, t]);
}
