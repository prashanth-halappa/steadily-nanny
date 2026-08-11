/**
 * Notification domain constants.
 *
 * @module domains/notification/constants
 */

import {
  PUSH_NOTIFICATION_TYPES,
  type PushNotificationType,
} from '@steadily-nanny/shared-types';

/**
 * Push types that must still deliver during quiet hours — they carry a
 * response deadline (reconfirm / change-request paths that auto-approve on
 * timeout), OR (D-28, A4) are child-safety-adjacent facts that must break
 * through. Opt-out still wins over this list.
 *
 * Asks (extra-shift proposals, uncovered-care pings, etc.) are NOT exempt:
 * silence does not auto-approve them, and a cover request at 23:40 for
 * tomorrow morning is exactly the kind of push quiet hours should defer.
 *
 * `shift_no_show` (D-28): "nobody has clocked in" is exactly the case this
 * exemption exists for. `shift_no_show_digest` — the morning catch-up for a
 * no-show quiet hours swallowed — is deliberately NOT exempt: by the time it
 * fires the window is long past and nothing is actionable, so it is
 * ordinary morning noise, not an alarm (§1.5/A12 in
 * docs/design/attention-and-notifications.md). Membership here is D-28's
 * closed list — revisit only via a new owner decision, not by adding a type
 * that merely "feels urgent".
 */
export const QUIET_HOURS_EXEMPT_TYPES: ReadonlySet<PushNotificationType> =
  new Set([
    PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM,
    PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED,
    PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW,
  ]);

/**
 * How close a shift must be for `cover_ask_expired` to break through quiet
 * hours (D-47, spec §1.3 ‡).
 */
export const COVER_ASK_EXPIRY_EXEMPT_WITHIN_MS = 12 * 60 * 60 * 1000;

/**
 * Is this specific push exempt from quiet hours?
 *
 * The set above is the unconditional, closed D-28 list and stays exactly that.
 * **D-47 adds the product's first CONDITIONAL exemption**, and it is a
 * deliberate, owner-decided extension rather than someone widening the list
 * because a type "feels urgent":
 *
 *   `cover_ask_expired` breaks through ONLY when the shift the ask was about
 *   starts within 12 hours.
 *
 * An ask that dies at 21:30 for an 07:00 shift is a child with nobody booked
 * in nine hours; deferring it to 07:00 hands the parent the news at the moment
 * it stops being fixable. An ask expiring four days out defers like everything
 * else — same shape as the `shift_no_show` exemption, child-safety-adjacent
 * facts break through and nothing else does.
 *
 * The condition reads the shift's own start instant off the payload. That is a
 * FACT the emitter carries, not a self-granted exemption flag: a payload
 * without `shiftStartsAt`, or with one more than 12h out, defers normally. Do
 * not "simplify" this into a boolean the caller sets — a push that can declare
 * itself exempt is a quiet-hours setting that does not work.
 */
export function isQuietHoursExempt(
  data: Record<string, unknown> | undefined,
  now: Date = new Date()
): boolean {
  const type = typeof data?.type === 'string' ? data.type : undefined;
  if (type === undefined) {
    return false;
  }
  if (QUIET_HOURS_EXEMPT_TYPES.has(type as PushNotificationType)) {
    return true;
  }
  if (type === PUSH_NOTIFICATION_TYPES.COVER_ASK_EXPIRED) {
    const startsAt = data?.shiftStartsAt;
    if (typeof startsAt !== 'string') {
      return false;
    }
    const untilStart = Date.parse(startsAt) - now.getTime();
    return (
      Number.isFinite(untilStart) &&
      untilStart < COVER_ASK_EXPIRY_EXEMPT_WITHIN_MS
    );
  }
  return false;
}

/**
 * Permission states a device may be PUSHED to.
 *
 * `provisional` is the silent iOS channel (Notification Center, no prompt)
 * often secured during onboarding. It MUST be a deliverable state — every
 * device-recipient query that omits it silently drops provisional users, which
 * is a common bug that leaves onboarding pushes reaching nobody. Use this
 * constant (via `.in('notification_permission', DELIVERABLE_NOTIFICATION_PERMISSIONS)`)
 * for ANY query selecting devices/tokens to send a push to.
 *
 * NOTE: This set governs PUSH deliverability only. Email deliverability is a
 * separate concern — the email domain gates on `email_log` (dedupe + daily cap)
 * and, if you add one, a preference row. Do NOT reuse this push-permission set
 * to decide whether an email may be sent.
 */
export const DELIVERABLE_NOTIFICATION_PERMISSIONS = [
  'granted',
  'provisional',
] as const;

/** Maximum push messages per Expo batch (Expo hard limit). */
export const EXPO_PUSH_BATCH_SIZE = 100;
