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
  // S11: a parent pulled back a pending proposal before the carer answered.
  // Carer-targeted, same as SCHEDULE_PATTERN_SENT — she is the one who was
  // waiting on it.
  SCHEDULE_PATTERN_WITHDRAWN: 'schedule_pattern_withdrawn',

  // Pay (TIER0-PLAN.md Phase 2)
  PAY_TERMS_SET: 'pay_terms_set',

  // PTO ledger (TIER0-PLAN.md Phase 3)
  PTO_USAGE_REVERSED: 'pto_usage_reversed',

  // A parent un-approved an already-approved week. Reuses the
  // `shift_events.event_type` string so the push and the audit row name the
  // same fact. Carer-targeted: she is the one whose pay just stopped being
  // final, and she may not open the app for days.
  TIMESHEET_REOPENED: 'timesheet_reopened',

  // The week thread (3-T1 / D-18 / D-46 / D-19 —
  // `docs/design/attention-and-notifications.md` §1.3 N3/N4).
  //
  // ONE type for the whole thread, deliberately: a parent's reply, a nanny's
  // reply, and a nanny OPENING a thread on a week nobody queried are the same
  // fact — someone said something about this week — with the same
  // destination. Audience `both`; the recipient is whoever did NOT write it.
  // Not named `timesheet_query_replied`, because a nanny-raised flag on a
  // clean week is not a reply, and a type key that lies is one someone adds a
  // second version of.
  TIMESHEET_NOTE_ADDED: 'timesheet_note_added',
  // A parent took their question back and the week is waiting on approval
  // again (D-19). Carer-targeted: she is the one who was told to look at it.
  TIMESHEET_QUERY_WITHDRAWN: 'timesheet_query_withdrawn',

  // Money leg — carer gets approval/payment outcomes; parents get submissions.
  EXPENSE_APPROVED: 'expense_approved',
  EXPENSE_REJECTED: 'expense_rejected',
  EXPENSE_SUBMITTED: 'expense_submitted',
  // A parent recorded a settlement against an approved week (067 payments) —
  // carer-targeted: she is the one who was just paid.
  PAYMENT_RECORDED: 'payment_recorded',
  // A parent reversed a payment they had recorded (D-20, §1.3 N5). Its own
  // type, never a second `payment_recorded`: "money was recorded for you" and
  // "money that was recorded for you has been taken back off the record" are
  // opposite facts, and sending the first for the second is the kind of push
  // that makes a nanny stop trusting the ledger. Carer-targeted — the parent
  // who typed it already knows.
  PAYMENT_CORRECTED: 'payment_corrected',
  // The family repaid what she spent out of pocket (D-14, §1.3 N6). Distinct
  // from PAYMENT_RECORDED for the reason 086's header gives at length: a
  // reimbursement is not wages, and one push covering both would be the first
  // step towards one table covering both.
  REIMBURSEMENT_SETTLED: 'reimbursement_settled',
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

  // Shift-floor FYIs that shipped as emitters before they were registered
  // here: the carer flags a late arrival to the household's parents, and a
  // parent taking a cover window tells the carer her day still starts on time.
  PARENT_COVERING: 'parent_covering',
  RUNNING_LATE: 'running_late',

  // 3-N: A2 fix. A pending cover-ask (kind='cover', status='pending') gets
  // the same evening-before reminder a confirmed shift already does —
  // reuses reminderJob's window/job, distinct type/key so muting one never
  // mutes the other (A6 shape).
  COVER_ASK_REMINDER: 'cover_ask_reminder',
  // 3-N: A1/D-26 catch-up. Morning sweep over yesterday's confirmed shifts
  // that had no clock-in and no confirmed shift_no_show claim — see
  // jobs/noShowDigestJob.ts.
  SHIFT_NO_SHOW_DIGEST: 'shift_no_show_digest',

  // 3-T3 / D-22 + D-47, matrix rows N8-N10
  // (docs/design/attention-and-notifications.md §1.3).
  //
  // N8: the ask died without an answer. Sent AT the stored
  // `shifts.cover_ask_expires_at` instant, and quiet-hours exempt when the
  // shift itself starts within 12h — see `isQuietHoursExempt`.
  COVER_ASK_EXPIRED: 'cover_ask_expired',
  // N9: she answered, and the answer was no. DELIBERATELY NOT `shift_declined`
  // (§1.4): A6 suppresses `shift_declined` once an uncovered push has fired
  // for the same window, and under D-22 the uncovered push now fires at ASK
  // time — so reusing `shift_declined` would suppress every cover-ask decline
  // and the parent would never learn she said no. A6 is untouched; this type
  // is simply not one of the ones it suppresses.
  COVER_ASK_DECLINED: 'cover_ask_declined',
  // N10: one push for a sick day, not `time_off_requested` plus N ×
  // `shift_change_requested` (A6). D-23 auto-opens a cancel request per
  // overlapping shift; this batches the lot.
  CARER_SICK_SHIFTS_AFFECTED: 'carer_sick_shifts_affected',
  // 3-U3: N17, D-32 extension. REPLACES `timesheet_approved` for a week whose
  // FROZEN snapshot still carries a `guaranteed_topup` line — the guarantee
  // was still short even after the unconditional top-up (or no arrangement
  // covered every day). One act, one push, never both
  // (`docs/design/attention-and-notifications.md` §1.4/§2.3b).
  WEEK_BELOW_GUARANTEE: 'week_below_guarantee',

  // 3-U1 (D-16 §7.4 / D-45 §8.3.1 / §6.1 — attention-and-notifications.md
  // §1.3 N18–N20). `docs/design/screens-pay-terms.md` owns the copy; that
  // doc owns the matrix rows — cross-spec by design, do not restate titles
  // here.
  //
  // N18 REPLACES pay_terms_set — never both — when a change backdated into
  // an already-worked week prices any UNAPPROVED week lower under the new
  // terms than the old (the walk-away fix, M1). A backdated RAISE stays the
  // ordinary pay_terms_set.
  PAY_TERMS_BACKDATED: 'pay_terms_backdated',
  // N19 REPLACES pay_terms_set — never both — when a SCHEDULED (future
  // valid_from) change is called off before it ever took effect (M4). The
  // generic "your terms changed" body would take the employer's side on a
  // raise that isn't happening.
  PAY_TERMS_SCHEDULED_CHANGE_CANCELLED: 'pay_terms_scheduled_change_cancelled',
  // N20 (D-45): the nanny recorded "I don't agree with this" on an
  // arrangement — parent-targeted, so the family sees it. Blocks nothing;
  // this is the push for the record, not for an approval gate.
  PAY_TERMS_DISAGREED: 'pay_terms_disagreed',

  // 3-O (D-35/D-49 — attention-and-notifications.md §1.3 N14–N17,
  // screens-onboarding-terms-proposal.md §13). A terms PROPOSAL is a
  // two-sided object with its own lifecycle, distinct from
  // `pay_terms_set`/`pay_terms_backdated`, which announce an arrangement that
  // ALREADY EXISTS. Nothing here is agreed yet — that is the whole point.
  //
  // All four are `hoursAndPay`, immediate, mutable, and NOT quiet-hours
  // exempt: the exemption list is child-safety-adjacent and a contract can
  // wait until 7am. None carries a FIGURE in its body, matching A8's
  // deliberate omission in TIMESHEET_APPROVED — a lock screen is a public
  // surface, and her rate is the thing she is most afraid of leaking.
  //
  // N14: she sent her terms; the family has to read them.
  TERMS_PROPOSAL_RECEIVED: 'terms_proposal_received',
  // N15: answered with changes, and the ball moved. Carer-targeted because a
  // counter always travels to whoever did NOT write it, and a counter to a
  // counter reuses this same type in the other direction.
  TERMS_PROPOSAL_COUNTERED: 'terms_proposal_countered',
  // N16: the binding act landed and a `pay_arrangements` row now exists.
  // Carer-targeted: the parent who tapped Agree already knows.
  TERMS_PROPOSAL_ACCEPTED: 'terms_proposal_accepted',
  // N17: pulled before an answer. Parent-targeted so a family that was about
  // to respond to terms that no longer stand finds out from the app rather
  // than from an awkward phone call.
  TERMS_PROPOSAL_WITHDRAWN: 'terms_proposal_withdrawn',
  // B4: the COUNTERPARTY refused, either direction — distinct from
  // TERMS_PROPOSAL_WITHDRAWN, which is the AUTHOR pulling her own round. One
  // type covers both directions (audience 'both' below) because a refusal
  // carries no figure to leak either way.
  TERMS_PROPOSAL_DECLINED: 'terms_proposal_declined',
  // Part 2 (B4 follow-on): TERMS_PROPOSAL_ACCEPTED's audience was fixed to
  // 'carer' from when only a parent could accept. Once a carer can accept a
  // `direction: 'parent'` round (the parent-offer flow), that fixed audience
  // can no longer cover her acceptance — the family authored the offer and
  // hears nothing. This is the parent-audience twin, emitted instead of
  // TERMS_PROPOSAL_ACCEPTED when the ACCEPTER is the carer.
  TERMS_OFFER_ACCEPTED: 'terms_offer_accepted',
  // WP-G: the author NUDGES her own unanswered round — one tap, never
  // automatic, and at most once every 48h (the gate is
  // `termsProposalCommandService.remind`, not a job). One type covers both
  // directions (audience 'both' below) because either side can be the one
  // waiting, and like the decline it carries no figure to leak either way.
  TERMS_PROPOSAL_REMINDER: 'terms_proposal_reminder',

  // Terms are agreed and a `pay_arrangements` row exists, but no schedule has
  // ever been started for that carer — `termsProposalCommandService.accept()`
  // is a money-only transition and nothing downstream asks for a week. Fired
  // by `reminderJob` on an UNDATED key, so it lands once per relationship and
  // then never again. NOT quiet-hours exempt: a missing schedule can wait
  // until the morning, and the exemption list is a closed child-safety set.
  SCHEDULE_NOT_SET: 'schedule_not_set',

  // F3 (AS-BUILT-PAY-TERMS.md §7): a parent's invite-attached pay_offer
  // failed to become a terms_proposal on redemption (`promoteOfferToProposal`
  // is best-effort and never throws — the join must stand regardless). Sent
  // only for the two outcomes the parent can actually act on by re-sending
  // terms: 'failed' and 'skipped_stale'. Parent-targeted: he is the one who
  // typed the offer and is the only one who can retype it.
  PAY_OFFER_NOT_PROMOTED: 'pay_offer_not_promoted',

  // Phase 2: a membership ENDED — the parent's household closed under her
  // (the last writer deleted their account) or a parent removed her. There
  // was no push, inbox item or card for any membership-ending event before
  // this: she just watched her controls disappear. Carer-targeted, and the
  // WHY travels in `data.reason` (and, for a reader who missed the push, in
  // `household_members.ended_reason`) rather than in a second type — one
  // fact, one type, two arms of copy, the same shape INVITE_REDEEMED uses.
  //
  // NOT quiet-hours exempt: that list is D-28's closed child-safety set and
  // this can wait until 7am. No figure in the body (A8) — a lock screen is a
  // public surface, and we say nothing about whether she will be paid,
  // because we cannot know and both answers are expensive lies.
  MEMBERSHIP_ENDED: 'membership_ended',

  // J1-b (S2 audit closeout): `jobHealthJob`'s own alert, fired when a
  // registered cron job's latest success is stale/missing or something
  // failed/partial in the last 24h. NOT a household-scoped fact — it goes
  // only to the user ids in `OPS_ALERT_USER_IDS` (an internal ops roster,
  // never a parent or carer in practice). Audience is classified 'both'
  // below only because the fixed union has no "ops-only" value; see that
  // entry's comment.
  OPS_JOB_HEALTH: 'ops_job_health',
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
  [PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER]: 'carer',
  [PUSH_NOTIFICATION_TYPES.EXPENSE_APPROVED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.EXPENSE_REJECTED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.EXPENSE_SUBMITTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.HANDOFF_NOTE_ADDED]: 'both',
  [PUSH_NOTIFICATION_TYPES.HOUSEHOLD_CLOSURE_CHANGED]: 'carer',
  // 3-O §13 — WIDENED from 'parent' on a shipped row, deliberately, and
  // called out in the slice diff because it changes what appears in a
  // nanny's notification settings.
  //
  // Under D-34 absorption both sides need this fact and they need different
  // sentences: he is adding one person to a family he already knows; she is
  // entering a home she has never seen (M25, §8.1). There is deliberately no
  // second `nanny_invite_redeemed` type — one fact, one type, two arms of
  // copy, role-forked at the deep link.
  [PUSH_NOTIFICATION_TYPES.INVITE_REDEEMED]: 'both',
  [PUSH_NOTIFICATION_TYPES.PARENT_COVERING]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PAYMENT_CORRECTED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PAYMENT_RECORDED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PAY_TERMS_BACKDATED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PAY_TERMS_DISAGREED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.PAY_TERMS_SCHEDULED_CHANGE_CANCELLED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PAY_OFFER_NOT_PROMOTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.PTO_MARKED_PAID]: 'carer',
  [PUSH_NOTIFICATION_TYPES.PTO_USAGE_REVERSED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.REIMBURSEMENT_SETTLED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.RUNNING_LATE]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_RESPONDED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT]: 'carer',
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_WITHDRAWN]: 'carer',
  [PUSH_NOTIFICATION_TYPES.SHIFT_CANCELLED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED]: 'both',
  [PUSH_NOTIFICATION_TYPES.SHIFT_CONFIRMED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_DECLINED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM]: 'carer',
  [PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW_DIGEST]: 'parent',
  // 3-T3: all three are the parent's alarm coming back — the person who
  // asked is the person owed the answer.
  [PUSH_NOTIFICATION_TYPES.COVER_ASK_EXPIRED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.COVER_ASK_DECLINED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.CARER_SICK_SHIFTS_AFFECTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_APPROVED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_AWAITING_APPROVAL]: 'parent',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_NOTE_ADDED]: 'both',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERIED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERY_WITHDRAWN]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_REOPENED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.TIME_OFF_REQUESTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DIGEST]: 'parent',
  [PUSH_NOTIFICATION_TYPES.WEEK_BELOW_GUARANTEE]: 'carer',
  // 3-O §13 (N14-N17): each goes to the side that must ACT, never the side
  // that just acted.
  [PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_RECEIVED]: 'parent',
  [PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_COUNTERED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_ACCEPTED]: 'carer',
  [PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_WITHDRAWN]: 'parent',
  // B4 — either side can be the counterparty who declines, so 'both', same
  // shape as CHANGE_REQUEST_DECLINED above.
  [PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_DECLINED]: 'both',
  // Part 2 — the parent-audience twin of TERMS_PROPOSAL_ACCEPTED, emitted
  // when the ACCEPTER is the carer so the family (who authored the offer)
  // hears it instead of the type going nowhere.
  [PUSH_NOTIFICATION_TYPES.TERMS_OFFER_ACCEPTED]: 'parent',
  // WP-G — the author is whichever side wrote the round, so the side being
  // nudged is whichever side did not. 'both', same shape as the decline.
  [PUSH_NOTIFICATION_TYPES.TERMS_PROPOSAL_REMINDER]: 'both',
  // Phase 2 — she is the one who lost the household. The parent who deleted
  // their account or tapped Remove already knows.
  [PUSH_NOTIFICATION_TYPES.MEMBERSHIP_ENDED]: 'carer',
  // Only the family can answer "when do you need her" — `reminderJob` sends
  // it through `listParentUserIds`, so 'parent' by the header's rule.
  [PUSH_NOTIFICATION_TYPES.SCHEDULE_NOT_SET]: 'parent',
  // J1-b: never actually sent to a parent or carer — only to
  // `OPS_ALERT_USER_IDS`. 'parent' would be actively wrong (nobody in that
  // role emits or receives it); the union has no ops-only value, so 'both'
  // is the least-wrong classification and is commented here for exactly
  // that reason. Its real gate is the env var, not this table.
  [PUSH_NOTIFICATION_TYPES.OPS_JOB_HEALTH]: 'both',
} as const;
