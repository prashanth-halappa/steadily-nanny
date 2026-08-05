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
 * response deadline (reconfirm / change-request / co-parent approval paths
 * that auto-approve on timeout). Opt-out still wins over this list.
 */
export const QUIET_HOURS_EXEMPT_TYPES: ReadonlySet<PushNotificationType> =
  new Set([
    PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM,
    PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED,
    // Co-parent approval for `extra_shift` parks then proposes to the carer.
    PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED,
    // Co-parent approval auto-approves by silence — quiet hours would hide the
    // deadline-bearing nudge and let silence become consent.
    PUSH_NOTIFICATION_TYPES.CO_PARENT_APPROVAL_REQUESTED,
    PUSH_NOTIFICATION_TYPES.APPROVAL_EXPIRING,
  ]);

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
