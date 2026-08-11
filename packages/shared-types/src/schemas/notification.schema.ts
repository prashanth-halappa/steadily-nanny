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
  CHANGE_REQUEST_EXPIRED: 'change_request_expired',
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
  // A parent recorded a settlement against an approved week (067 payments) —
  // carer-targeted: she is the one who was just paid.
  PAYMENT_RECORDED: 'payment_recorded',
  PTO_MARKED_PAID: 'pto_marked_paid',
  TIMESHEET_APPROVED: 'timesheet_approved',

  // Shift / schedule leg — parents get uncovered-care alerts, shift
  // confirmations, and time-off requests; the carer gets closure changes,
  // since a closure moves her paid days.
  UNCOVERED_CARE_DETECTED: 'uncovered_care_detected',
  // Household-local evening batch of uncovered windows too far out for the
  // immediate alert — a distinct type so muting the digest can never mute
  // the "cover just broke" push above. Never in QUIET_HOURS_EXEMPT_TYPES: it
  // is the definition of non-urgent.
  UNCOVERED_CARE_DIGEST: 'uncovered_care_digest',
  HOUSEHOLD_CLOSURE_CHANGED: 'household_closure_changed',
  SHIFT_CONFIRMED: 'shift_confirmed',
  // The carer's symmetric "no" to SHIFT_CONFIRMED — parent-targeted: the
  // family now has a gap where they thought they had cover.
  SHIFT_DECLINED: 'shift_declined',
  TIME_OFF_REQUESTED: 'time_off_requested',

  // Household leg — FYI when another parent acts; invites go to parents.
  // Handoff notes go to whichever side did not write the note.
  CO_PARENT_ACTION_FYI: 'co_parent_action_fyi',
  HANDOFF_NOTE_ADDED: 'handoff_note_added',
  INVITE_REDEEMED: 'invite_redeemed',

  // Scheduled reminders (emitted by the reminder cron job, not by a write) —
  // parents get the unapproved-week nudge; the carer gets tomorrow's shift
  // reminder.
  SHIFT_REMINDER: 'shift_reminder',
  TIMESHEET_AWAITING_APPROVAL: 'timesheet_awaiting_approval',

  // Nobody clocked in 20+ minutes into a confirmed shift — emitted by the
  // no-show sweep to the household's parents, who are the only people who can
  // act on it. Never sent to the carer: she is either already there (in which
  // case the alert is wrong) or unreachable.
  SHIFT_NO_SHOW: 'shift_no_show',
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

export type PushAudience = 'parent' | 'carer' | 'both' | 'any';

/**
 * Who can actually RECEIVE each push type. Drives the notification-settings
 * screen so a role is never offered a toggle for a push it can never get.
 * Typed as a total Record so a newly added push type fails to compile until
 * it is classified here.
 *
 * Classified by grepping each emitter in `apps/api/src`: `notifyHouseholdParents`
 * ⇒ `'parent'`, `notifyUser(carerId, …)` ⇒ `'carer'`, and types routed to
 * either leg depending on who acted ⇒ `'both'`.
 */
export const PUSH_TYPE_AUDIENCE: Record<PushNotificationType, PushAudience> = {
  [PUSH_NOTIFICATION_TYPES.CARER_TIME_OFF_CONFLICT]: 'parent',
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_ACCEPTED]: 'both',
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_DECLINED]: 'both',
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_EXPIRED]: 'any',
  [PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_WITHDRAWN]: 'both',
  [PUSH_NOTIFICATION_TYPES.CLOCK_OUT_REMINDER]: 'carer',
  [PUSH_NOTIFICATION_TYPES.CO_PARENT_ACTION_FYI]: 'parent',
  [PUSH_NOTIFICATION_TYPES.EXPENSE_APPROVED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.EXPENSE_REJECTED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.EXPENSE_SUBMITTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.HANDOFF_NOTE_ADDED]: 'both',
  [PUSH_NOTIFICATION_TYPES.HOUSEHOLD_CLOSURE_CHANGED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.PAYMENT_RECORDED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PTO_MARKED_PAID]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PTO_USAGE_REVERSED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_RESPONDED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT]: 'carer',
  [PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED]: 'both',
  [PUSH_NOTIFICATION_TYPES.SHIFT_CONFIRMED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM]: 'carer',
  [PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_AWAITING_APPROVAL]: 'parent',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERIED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_REOPENED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST]: 'parent',
} as const;
