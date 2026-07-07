/**
 * Notification domain constants.
 *
 * @module domains/notification/constants
 */

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
