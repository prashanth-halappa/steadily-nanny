/**
 * Push notification `data.type` union — shared by API emitters and the mobile
 * deep-link route map. Every emitter and every map entry must use these
 * literals; Batch-2 tests assert exhaustiveness against this const-map so the
 * route map cannot silently rot back to `{}`.
 *
 * @module packages/shared-types/src/schemas/notification.schema
 */

import { z } from 'zod';

/**
 * Semantic push / local-notification types the product can emit.
 * Keep alphabetically sorted within groups for diff readability.
 */
export const PUSH_NOTIFICATION_TYPES = {
  // Existing emitters
  CLOCK_OUT_REMINDER: 'clock_out_reminder',
  SCHEDULE_PATTERN_RESPONDED: 'schedule_pattern_responded',
  SHIFT_CHANGE_REQUESTED: 'shift_change_requested',
  TIMESHEET_SUBMITTED: 'timesheet_submitted',

  // Shift response-leg + consent (Batch 1 / 1A)
  CHANGE_REQUEST_ACCEPTED: 'change_request_accepted',
  CHANGE_REQUEST_DECLINED: 'change_request_declined',
  CHANGE_REQUEST_WITHDRAWN: 'change_request_withdrawn',
  EXTRA_SHIFT_PROPOSED: 'extra_shift_proposed',
  SHIFT_CANCELLED: 'shift_cancelled',
  SHIFT_NEEDS_RECONFIRM: 'shift_needs_reconfirm',

  // Availability (Batch 1 / 1B)
  CARER_TIME_OFF_CONFLICT: 'carer_time_off_conflict',

  // Timesheet (Batch 1 / 1C)
  TIMESHEET_QUERIED: 'timesheet_queried',

  // Schedule (Batch 1 / 2A)
  SCHEDULE_PATTERN_AMENDED: 'schedule_pattern_amended',
  SCHEDULE_PATTERN_SENT: 'schedule_pattern_sent',

  // Pay (TIER0-PLAN.md Phase 2)
  PAY_TERMS_SET: 'pay_terms_set',
} as const;

export type PushNotificationType =
  (typeof PUSH_NOTIFICATION_TYPES)[keyof typeof PUSH_NOTIFICATION_TYPES];

export const PushNotificationTypeSchema = z.enum(
  Object.values(PUSH_NOTIFICATION_TYPES) as [
    PushNotificationType,
    ...PushNotificationType[],
  ]
);

/** Every push type value — useful for exhaustiveness tests on the route map. */
export const ALL_PUSH_NOTIFICATION_TYPES: readonly PushNotificationType[] =
  Object.values(PUSH_NOTIFICATION_TYPES);
