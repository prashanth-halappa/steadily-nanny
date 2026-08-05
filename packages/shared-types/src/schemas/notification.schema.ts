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

  // PTO ledger (TIER0-PLAN.md Phase 3)
  PTO_USAGE_REVERSED: 'pto_usage_reversed',

  // A parent un-approved an already-approved week. Reuses the
  // `shift_events.event_type` string so the push and the audit row name the
  // same fact. Carer-targeted: she is the one whose pay just stopped being
  // final, and she may not open the app for days.
  TIMESHEET_REOPENED: 'timesheet_reopened',

  // Money leg — carer gets approval/payment outcomes; parents get submissions.
  EXPENSE_APPROVED: 'expense_approved',
  EXPENSE_REJECTED: 'expense_rejected',
  EXPENSE_SUBMITTED: 'expense_submitted',
  PTO_MARKED_PAID: 'pto_marked_paid',
  TIMESHEET_APPROVED: 'timesheet_approved',

  // Shift / schedule leg — parents get coverage gaps, shift confirmations, and
  // time-off requests; the carer gets closure changes, since a closure moves
  // her paid days.
  COVERAGE_GAP_DETECTED: 'coverage_gap_detected',
  HOUSEHOLD_CLOSURE_CHANGED: 'household_closure_changed',
  SHIFT_CONFIRMED: 'shift_confirmed',
  TIME_OFF_REQUESTED: 'time_off_requested',

  // Household / consent leg — approval types are parent-to-parent (requested
  // goes to the other parent, resolved back to the requester) and invites go to
  // parents. Handoff notes go to whichever side did not write the note.
  CO_PARENT_APPROVAL_REQUESTED: 'co_parent_approval_requested',
  CO_PARENT_APPROVAL_RESOLVED: 'co_parent_approval_resolved',
  HANDOFF_NOTE_ADDED: 'handoff_note_added',
  INVITE_REDEEMED: 'invite_redeemed',

  // Scheduled reminders (emitted by the reminder cron job, not by a write) —
  // parents get the approval-expiring nudge and the unapproved-week nudge; the
  // carer gets tomorrow's shift reminder.
  APPROVAL_EXPIRING: 'approval_expiring',
  SHIFT_REMINDER: 'shift_reminder',
  TIMESHEET_AWAITING_APPROVAL: 'timesheet_awaiting_approval',
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
