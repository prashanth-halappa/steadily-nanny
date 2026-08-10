/**
 * Time-tracking wire contract: clock in/out, and the weekly timesheet.
 * @module packages/shared-types/src/schemas/timesheet.schema
 *
 * Backing tables: `time_entries`, `timesheets`
 * (supabase/migrations/017_time_tracking.sql).
 *
 * "Hours only — no payments here." This records what actually happened,
 * which is deliberately NOT the same as what was scheduled — see the
 * migration's header comment before touching this. `local_date` on
 * `TimeEntrySchema` and `week_start` on `TimesheetSchema` are both
 * trigger/service derived, never client-set.
 */

import { z } from 'zod';
import { MAX_MONEY_MINOR } from './payArrangement.schema';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** time_entries.kind */
export const TIME_ENTRY_KINDS = {
  WORKED: 'worked',
  CANCELLATION_PAID: 'cancellation_paid',
  MANUAL_ADJUSTMENT: 'manual_adjustment',
} as const;
export type TimeEntryKind =
  (typeof TIME_ENTRY_KINDS)[keyof typeof TIME_ENTRY_KINDS];

/**
 * time_entries.status
 *
 * `voided` is a SOFT DELETE (069): the carer withdrew an entry that should
 * never have existed — an accidental clock-in, a duplicate, a retroactive
 * entry filed on the wrong day. Never a hard delete; a time entry is a pay
 * record, and a week where a row silently vanished is unanswerable in a
 * dispute (same reasoning as `timeOffCommandService.cancel`'s
 * `status = 'cancelled'`).
 *
 * ONE RULE, EVERYWHERE: a voided entry did not happen. It earns nothing, it
 * occupies no clock time, it does not freeze a shift, and it does not count
 * as coverage. Every read that lists or sums entries either applies that
 * rule or carries a comment saying why it is an exception — there is NO
 * exhaustive switch over this type in either app, so the compiler will not
 * catch a missed branch. Tests are the only net.
 *
 * The one place it is deliberately NOT filtered is the household week read
 * (`listForHouseholdWeek`): the client renders voided rows struck through,
 * so it needs them, and the exclusion lives in the mobile sum instead.
 */
export const TIME_ENTRY_STATUSES = {
  RUNNING: 'running',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  QUERIED: 'queried',
  VOIDED: 'voided',
} as const;
export type TimeEntryStatus =
  (typeof TIME_ENTRY_STATUSES)[keyof typeof TIME_ENTRY_STATUSES];

/**
 * timesheets.status
 *
 * PRODUCT DECISION (owner, 2026-08-06, audit closeout): there is deliberately
 * NO carer-facing submit step. `rollUpIntoTimesheet` births every timesheet as
 * 'submitted' the moment hours land and re-writes 'submitted' on every entry
 * change (un-approving an approved week and re-notifying the parent). A parent
 * may approve mid-week; later hours auto-reopen. 'open' is therefore a dead
 * value — 017's column default that no code path ever writes — kept only so
 * the DB CHECK and this enum stay aligned with the schema. Do not "fix" the
 * missing submit route; an explicit submit model was considered and declined.
 */
export const TIMESHEET_STATUSES = {
  OPEN: 'open',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  QUERIED: 'queried',
} as const;
export type TimesheetStatus =
  (typeof TIMESHEET_STATUSES)[keyof typeof TIMESHEET_STATUSES];

/**
 * Hard ceiling on a single worked session span (`clock_out - clock_in`).
 *
 * Soft counterpart on mobile: `MAX_UNSCHEDULED_SHIFT_MS` in
 * `apps/mobile/src/domains/today/utils/clockOutReminder.ts` (10h reminder).
 * This hard reject must stay ABOVE that reminder so the client warns before
 * the server refuses — same concept, two thresholds.
 *
 * Lives here, not in the service, because the mobile client now guards against
 * this same value before submitting — one shared source, never two copies that
 * can drift apart.
 *
 * Service-layer, not a DB constraint: a live-in or split arrangement may
 * legitimately need a higher bound later without a migration.
 *
 * ponytail: calibration knob, not a law of physics — raise if a real
 * household's longest legitimate session sits above 16h. Raising it past 24h
 * needs `clockOutAcrossWeeks` to loop: it splits at ONE week boundary because
 * no session shorter than a day can cross two.
 */
export const MAX_SESSION_SPAN_MS = 16 * 60 * 60 * 1000;

// =============================================================================
// time_entries
// =============================================================================

/** The persisted entity as returned to clients. */
export const TimeEntrySchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: a carer who deletes her account leaves this row behind for the
  // household's payroll record — `carer_id` goes to NULL (ON DELETE SET
  // NULL, see 033_preserve_payroll_on_carer_deletion.sql) rather than
  // cascading the deletion. `carer_display_name` is the durable identifier.
  carer_id: z.uuid().nullable(),
  // Snapshotted at record-creation time from the carer's profile — never
  // derived on read, so the name survives the profile being deleted.
  carer_display_name: z.string(),
  // The `household_members.id` this row was written under, stamped at insert
  // by 058's trigger and carrying NO foreign key, so it outlives the
  // membership row that account deletion cascades away. It is the identity
  // `carer_id` stops being and `carer_display_name` never was: two departed
  // carers who shared a name are still two people here.
  //
  // Optional AND nullable, both meaning "no bucket key": optional for a row
  // written before 058, null for a row inserted with no `carer_id` to resolve
  // a membership from. Consumers fall back to the display name for either.
  household_member_id: z.uuid().nullable().optional(),
  // Nullable: a carer can clock in on a day with no scheduled shift.
  shift_id: z.uuid().nullable(),
  clock_in_at: z.iso.datetime({ offset: true }).nullable(),
  clock_out_at: z.iso.datetime({ offset: true }).nullable(),
  break_minutes: z.int().min(0),
  // For worked rows: frozen at clock-out, informational — must not drift if
  // the shift is later edited. For `cancellation_paid` rows it is the
  // AUTHORITATIVE paid minutes (may carry a rounding residual, so it can
  // differ from the row's own span by a minute) — both totals and earnings
  // read it via `entryMinutes` on each side of the wire.
  scheduled_minutes: z.int().nullable(),
  kind: z.enum(Object.values(TIME_ENTRY_KINDS)),
  note: z.string().nullable(),
  // Reassurance, never a gate. Null means "we did not check".
  clock_in_location_ok: z.boolean().nullable(),
  clock_out_location_ok: z.boolean().nullable(),
  status: z.enum(Object.values(TIME_ENTRY_STATUSES)),
  // Trigger-derived from clock_in_at/clock_out_at/timezone — never client-set.
  local_date: z.iso.date(),
  timezone: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST /time-entries/clock-in body. */
export const ClockInSchema = z.object({
  household_id: z.uuid(),
  shift_id: z.uuid().optional(),
});

/**
 * POST /time-entries/:id/clock-out body — every field optional.
 *
 * `clock_out_at` exists for the FORGOTTEN clock-out only (Daylight UX #7): a
 * carer who left at 17:00 and taps "Clock out" the next morning must not
 * have 14 idle hours recorded as worked. The client supplies the scheduled
 * finish (or a time the carer typed), and the server bounds it — see
 * `assertClockOrder` in `timesheetCommandService`. Omitting it keeps the
 * ordinary behaviour: the server's own clock, i.e. what actually happened.
 */
export const ClockOutSchema = z.object({
  break_minutes: z.int().min(0).optional(),
  note: z.string().optional(),
  clock_out_at: z.iso.datetime({ offset: true }).optional(),
});

/**
 * PATCH /time-entries/:id body — the carer's correction path (Daylight UX
 * P0-2). Every field optional, but at least one must be present: an empty
 * patch is a client bug, not a no-op worth silently accepting.
 *
 * Editable only while the week is still unapproved — the gate lives in
 * `timesheetCommandService.updateEntry`, not here, because it depends on the
 * entry's own state rather than the request shape.
 */
export const UpdateTimeEntrySchema = z
  .object({
    clock_in_at: z.iso.datetime({ offset: true }).optional(),
    clock_out_at: z.iso.datetime({ offset: true }).optional(),
    break_minutes: z.int().min(0).optional(),
    note: z.string().optional(),
  })
  .refine(patch => Object.values(patch).some(value => value !== undefined), {
    message: 'At least one field must be supplied',
  });

/**
 * POST /time-entries/retroactive body — forgotten clock-in recovery. Both
 * ends are required (there is no "running" phase): the entry lands
 * `submitted` and rolls into the week total immediately. `submitted` is
 * implicit on create here the same way it is on clock-out — there is no
 * separate submit step.
 */
export const CreateRetroactiveTimeEntrySchema = z.object({
  household_id: z.uuid(),
  clock_in_at: z.iso.datetime({ offset: true }),
  clock_out_at: z.iso.datetime({ offset: true }),
  break_minutes: z.int().min(0).optional(),
  note: z.string().optional(),
  shift_id: z.uuid().optional(),
});

/** List response envelope. */
export const TimeEntryListResponseSchema = z.object({
  time_entries: z.array(TimeEntrySchema),
});

export type TimeEntry = z.infer<typeof TimeEntrySchema>;
export type ClockInInput = z.infer<typeof ClockInSchema>;
export type ClockOutInput = z.infer<typeof ClockOutSchema>;
export type UpdateTimeEntryInput = z.infer<typeof UpdateTimeEntrySchema>;
export type CreateRetroactiveTimeEntryInput = z.infer<
  typeof CreateRetroactiveTimeEntrySchema
>;
export type TimeEntryListResponse = z.infer<typeof TimeEntryListResponseSchema>;

// =============================================================================
// timesheets
// =============================================================================

/** The persisted entity as returned to clients. */
export const TimesheetSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable — see TimeEntrySchema.carer_id; same ON DELETE SET NULL, same
  // reason: a deleted carer must not take the parent's approved timesheet
  // history with her.
  carer_id: z.uuid().nullable(),
  // Snapshotted at record-creation time from the carer's profile — never
  // derived on read, so the name survives the profile being deleted.
  carer_display_name: z.string(),
  // See `TimeEntrySchema.household_member_id` — same 058 stamp, same
  // optional/nullable meaning. The week screen buckets entries and timesheets
  // with one key, so it has to be on both or the two sides disagree.
  household_member_id: z.uuid().nullable().optional(),
  // Monday, in the household's timezone — en-GB weeks start Monday.
  week_start: z.iso.date(),
  total_minutes: z.int(),
  status: z.enum(Object.values(TIMESHEET_STATUSES)),
  approved_by: z.uuid().nullable(),
  approved_at: z.iso.datetime({ offset: true }).nullable(),
  // "Query Thursday" — an approval escape hatch that names the disagreement.
  query_note: z.string().nullable(),
  // Why a parent un-approved this week, carried on the row so it survives a
  // cold start — the in-memory "reopened" caption only fires for a component
  // that WATCHED the transition, so a carer opening the app two days later
  // saw nothing at all. Display state, not the record: it is cleared on
  // re-approval, while the append-only `timesheet_reopened` shift_event
  // remains the permanent audit. Two facts, two places (docs/11-MONEY.md §3).
  reopen_reason: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST /timesheets/:id/query body. */
export const QueryTimesheetSchema = z.object({
  note: z.string().min(1, 'note is required'),
});

/**
 * POST /timesheets/:id/reopen body — the undo for `approve`.
 *
 * An approved week that is no longer the current week is otherwise frozen
 * for good: every correction path (`updateEntry`, `createRetroactiveEntry`,
 * `recordCancellationPaidEntry`) rejects it, and even the parent's own
 * `query` action is refused because only `submitted` is actionable. Without
 * this the sole remediation for a wrong approved total is a manual DB write.
 *
 * Reopening returns the week to `submitted` and clears the frozen earnings
 * snapshot, so the figure is recomputed from whatever the entries then say.
 * Parent-only, and money-visible — hence the required reason, which is
 * recorded rather than being a confirm-dialog nicety.
 */
export const ReopenTimesheetSchema = z.object({
  reason: z.string().min(1, 'reason is required'),
});

/**
 * Ceiling on the parent's adjustment reason. Same 200 as
 * `PAYMENT_METHOD_NOTE_MAX` — both are one line a person types beside a
 * figure, and two different limits for the same gesture would be arbitrary.
 */
export const TIMESHEET_ADJUSTMENT_NOTE_MAX = 200;

/**
 * A parent's one final correction to a week's gross, folded into the frozen
 * snapshot at approval — a bonus, a reimbursement-style extra, or a
 * deduction. Real pay routinely differs from hours × rate.
 *
 * ONE signed amount and ONE required note per week; no categories, no line
 * items. The note is REQUIRED because the carer reads it beside the figure on
 * the approved breakdown — an unexplained deduction is the single worst thing
 * this feature could ship.
 *
 * `amount_minor` is the only SIGNED money field on the wire. It is
 * deliberately NOT an `EarningsLine`: every line's `amount_minor` is
 * `min(0)`, and relaxing that to let one kind go negative would weaken the
 * invariant for all six. This is a SIBLING field on the `ok` earnings arm
 * instead, so every per-line rule stays exactly as strict as it was.
 *
 * Zero is refused rather than accepted-and-ignored: an adjustment of nothing
 * is a client bug or a parent who meant to remove it, and silently freezing
 * `{amount_minor: 0, note: "…"}` would print a meaningless row on the
 * carer's breakdown forever.
 */
export const TimesheetAdjustmentSchema = z.object({
  amount_minor: z
    .int()
    .min(-MAX_MONEY_MINOR)
    .max(MAX_MONEY_MINOR)
    .refine(value => value !== 0, 'zero adjustment — omit instead'),
  note: z.string().trim().min(1).max(TIMESHEET_ADJUSTMENT_NOTE_MAX),
  /** Who applied it. Nullable for the same reason `approved_by` is: 033. */
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/**
 * POST /timesheets/:id/approve body.
 *
 * `.nullish()` and the whole body optional: every client shipped before this
 * feature posts approve with NO body at all, and `{}` must keep meaning
 * "approve the computed total, unchanged". The server stamps `created_by`
 * and `created_at` — a client never supplies either.
 */
export const ApproveTimesheetSchema = z.object({
  adjustment: TimesheetAdjustmentSchema.pick({
    amount_minor: true,
    note: true,
  }).nullish(),
});

/** List response envelope. */
export const TimesheetListResponseSchema = z.object({
  timesheets: z.array(TimesheetSchema),
});

export type Timesheet = z.infer<typeof TimesheetSchema>;
export type TimesheetAdjustment = z.infer<typeof TimesheetAdjustmentSchema>;
export type ApproveTimesheetInput = z.infer<typeof ApproveTimesheetSchema>;
export type QueryTimesheetInput = z.infer<typeof QueryTimesheetSchema>;
export type ReopenTimesheetInput = z.infer<typeof ReopenTimesheetSchema>;
export type TimesheetListResponse = z.infer<typeof TimesheetListResponseSchema>;

// =============================================================================
// earnings — the priced week (Tier 0 Phase 2)
// =============================================================================
//
// The output of `apps/api/src/domains/pay/services/earningsService.ts`, and
// the shape frozen into `timesheets.earnings` at approval (migration 042).
// Read `docs/11-MONEY.md` §3 and §7 plus `docs/TIER0-CX-SPEC.md` §4.2 before
// changing anything here: the breakdown sheet renders these rows verbatim and
// its total must visibly equal their sum.
//
// Money is integer minor units + a sibling ISO-4217 code, never a float
// (`docs/11-MONEY.md` §1). There is no `Money` object on the wire.

/**
 * The kinds of line the breakdown can carry.
 *
 * `PTO` and `REIMBURSEMENTS` exist from day one and are emitted by nothing
 * yet — Phase 3 fills PTO, Phase 4 fills reimbursements. The shape lands now
 * on purpose (TIER0-PLAN.md Phase 2) so the mobile contract does not change
 * under a shipped client later.
 *
 * Note there is deliberately NO `manual_adjustment` line kind, even though
 * `docs/TIER0-CX-SPEC.md` §4.2's table lists an "Adjustment" row: a
 * `manual_adjustment` time entry is a *correction of worked time*, so its
 * minutes fold into `regular`/`overtime` exactly like `worked` minutes
 * (TIER0-PLAN.md's "worked minutes" definition). Pricing it as its own line
 * would double-count it. The CX row, if it is ever wanted, is an entry-level
 * annotation, not an earnings line.
 *
 * The parent's approval-time adjustment is a DIFFERENT thing again and lives
 * on `WeekEarningsSchema`'s `ok` arm as `adjustment` — money, not minutes, and
 * deliberately not a line kind (see `TimesheetAdjustmentSchema`). Do not
 * "unify" the three.
 */
export const EARNINGS_LINE_KINDS = {
  REGULAR: 'regular',
  OVERTIME: 'overtime',
  CANCELLATION_PAID: 'cancellation_paid',
  GUARANTEED_TOPUP: 'guaranteed_topup',
  PTO: 'pto',
  REIMBURSEMENTS: 'reimbursements',
} as const;
export type EarningsLineKind =
  (typeof EARNINGS_LINE_KINDS)[keyof typeof EARNINGS_LINE_KINDS];

/**
 * The order lines are emitted (and rendered) in — `docs/TIER0-CX-SPEC.md`
 * §4.2's fixed table order, which is NOT the declaration order of the
 * const-map above (the spec puts `pto` before `guaranteed_topup`; the plan's
 * prose lists them the other way round — the spec wins because it is what the
 * reader sees). `reimbursements` sorts last because it renders *below* the
 * gross total, never inside it (`docs/11-MONEY.md` §6).
 */
export const EARNINGS_LINE_ORDER = [
  EARNINGS_LINE_KINDS.REGULAR,
  EARNINGS_LINE_KINDS.OVERTIME,
  EARNINGS_LINE_KINDS.CANCELLATION_PAID,
  EARNINGS_LINE_KINDS.PTO,
  EARNINGS_LINE_KINDS.GUARANTEED_TOPUP,
  EARNINGS_LINE_KINDS.REIMBURSEMENTS,
] as const satisfies readonly EarningsLineKind[];

/** The three arms of a week's earnings result. */
export const EARNINGS_RESULT_STATUSES = {
  OK: 'ok',
  /** No effective arrangement covers some day the week needs priced. */
  NO_ARRANGEMENT: 'no_arrangement',
  /** The week spans an arrangement currency change — one currency per week. */
  CURRENCY_CHANGE: 'currency_change',
} as const;
export type EarningsResultStatus =
  (typeof EARNINGS_RESULT_STATUSES)[keyof typeof EARNINGS_RESULT_STATUSES];

/**
 * ISO-4217: exactly three UPPERCASE letters, the same regex
 * `payArrangement.schema.ts` pins (and the same DB check). Not `.length(3)` —
 * `"gbp"` and `"ab1"` are three characters and neither is a currency, and
 * `formatMoney` hands this straight to `Intl.NumberFormat`.
 */
const EarningsCurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/**
 * One row of the breakdown sheet.
 *
 * `minutes` × `rate_minor` ÷ 60, rounded HALF-UP exactly once, is
 * `amount_minor` — so the row reproduces its own amount and the total is the
 * visible sum of the rows (`docs/TIER0-CX-SPEC.md` §4.2).
 *
 * `rate_minor` is the rate *as displayed on this row*: for an `overtime` line
 * that is the already-multiplied hourly rate (base × `multiplier`, itself
 * rounded half-up to minor units), so the sub-line "3h 00m at £27.75 (1.5×)"
 * is self-consistent.
 *
 * `from_date`/`to_date` are the inclusive household-local span the line
 * covers. They are what makes the mid-week-raise split renderable ("12h 00m
 * at £18.50 (to Wed 3 Sep)"); a single-day line has them equal, and a
 * `guaranteed_topup` line spans the whole week.
 */
export const EarningsLineSchema = z.object({
  kind: z.enum(Object.values(EARNINGS_LINE_KINDS)),
  minutes: z.int().min(0),
  rate_minor: z.int().min(0),
  /** Overtime only; null on every other kind. Never below 1. */
  multiplier: z.number().min(1).nullable(),
  amount_minor: z.int().min(0),
  from_date: z.iso.date(),
  to_date: z.iso.date(),
  /**
   * The arrangement that priced this line — the audit trail that makes a
   * frozen snapshot self-describing after the arrangement changes. Nullable
   * for lines no arrangement priced (none today; Phase 4 reimbursements).
   */
  arrangement_id: z.uuid().nullable(),
});

/**
 * A week's earnings — a discriminated union, never a nullable total.
 *
 * The two non-`ok` arms deliberately carry NO money fields at all. A `0`
 * where a rate is missing is indistinguishable from "correctly computed to
 * nothing", and a silently wrong zero is the worst output a pay feature can
 * produce (`docs/11-MONEY.md` §4).
 */
export const WeekEarningsSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal(EARNINGS_RESULT_STATUSES.OK),
    week_start: z.iso.date(),
    currency: EarningsCurrencyCodeSchema,
    /** In `EARNINGS_LINE_ORDER`, then chronological. Empty lines are omitted. */
    lines: z.array(EarningsLineSchema),
    /**
     * Sum of every line EXCEPT `reimbursements`, PLUS the parent's
     * approval-time `adjustment` when there is one — wages only:
     *
     *   gross_minor === sum(non-reimbursement lines) + (adjustment?.amount_minor ?? 0)
     *
     * Still `min(0)`: a deduction that would push the week negative is
     * REFUSED at approval, never clamped (`TimesheetAdjustmentNegativeGrossError`).
     */
    gross_minor: z.int().min(0),
    /** Summed separately and never part of gross (`docs/11-MONEY.md` §6). */
    reimbursements_minor: z.int().min(0),
    /** `worked` + `manual_adjustment`. The only basis for overtime. */
    worked_minutes: z.int().min(0),
    /** worked + `cancellation_paid` + PTO usage — the guaranteed-hours basis. */
    payable_minutes: z.int().min(0),
    /** Echoed so the top-up sub-line can read "to reach the agreed 40h". */
    guaranteed_minutes_per_week: z.int().min(0).nullable(),
    /**
     * The parent's final correction, frozen with the rest of the snapshot.
     *
     * `.nullable().optional()` IS LOAD-BEARING, not defensive style. Every
     * frozen snapshot written before this feature has no `adjustment` key at
     * all, and the read path re-parses `timesheets.earnings` through this
     * schema on EVERY read (`timesheetQueryService`) — a required field here
     * would fail that parse and silently degrade every already-approved week
     * in production to `hours_only`. Optional covers the legacy rows; nullable
     * covers a client or store that writes an explicit null.
     */
    adjustment: TimesheetAdjustmentSchema.nullable().optional(),
  }),
  z.object({
    status: z.literal(EARNINGS_RESULT_STATUSES.NO_ARRANGEMENT),
    week_start: z.iso.date(),
    /** The household-local dates with no effective arrangement, ascending. */
    unpriced_dates: z.array(z.iso.date()),
  }),
  z.object({
    status: z.literal(EARNINGS_RESULT_STATUSES.CURRENCY_CHANGE),
    week_start: z.iso.date(),
    /** Distinct codes in the order the week meets them. Two or more, always. */
    currencies: z.array(EarningsCurrencyCodeSchema).min(2),
  }),
]);

export type EarningsLine = z.infer<typeof EarningsLineSchema>;
export type WeekEarnings = z.infer<typeof WeekEarningsSchema>;
export type WeekEarningsOk = Extract<WeekEarnings, { status: 'ok' }>;

// =============================================================================
// the week response — a timesheet with its earnings attached
// =============================================================================
//
// What `GET /timesheets/:id` returns, and what the Hours screen renders. The
// server decides between LIVE and FROZEN here so the client never can:
// open/submitted/queried weeks carry a freshly computed `WeekEarnings`, an
// approved week carries the snapshot frozen into `timesheets.earnings` at
// approval, and neither is distinguishable from the other by shape — the
// `status` word beside the amount comes from `timesheets.status`
// (`docs/11-MONEY.md` §3, "state labels are mandatory").

/**
 * The one state the ENGINE can never produce: this week shows hours and no
 * money, permanently.
 *
 * It exists because a week `approved` before migration 042 has a NULL
 * snapshot and is never backfilled. Recomputing it live would print today's
 * arrangement under an "Approved" label — the exact silent substitution
 * `docs/11-MONEY.md` §3 forbids. Returning `null` instead would be worse
 * still: every client would have to reinvent this decision, and one of them
 * would eventually get it wrong. So the server names the state.
 */
export const WEEK_EARNINGS_STATES = {
  ...EARNINGS_RESULT_STATUSES,
  HOURS_ONLY: 'hours_only',
} as const;
export type WeekEarningsState =
  (typeof WEEK_EARNINGS_STATES)[keyof typeof WEEK_EARNINGS_STATES];

/**
 * Why a week is hours-only. The arms render similarly; they are
 * distinguished because they mean very different things to whoever is
 * debugging — and because `carer_removed` needs its own copy on screen.
 *
 * - `legacy_approval` — approved before migration 042, so the snapshot is
 *   NULL and always will be. Expected, permanent, not a defect.
 * - `unreadable_snapshot` — a frozen jsonb that failed `WeekEarningsSchema`.
 *   A real data defect worth finding, which the read path degrades around
 *   rather than crashing on: a nanny opening Hours must not get a blank
 *   screen because one row is malformed.
 * - `carer_removed` — the timesheet's `carer_id` is NULL (the carer deleted
 *   her account; 033 keeps the payroll record). There is no carer to resolve
 *   an arrangement against, and per `docs/11-MONEY.md` §4 the parent must NOT
 *   be shown a "set a pay rate" nudge they cannot complete.
 */
export const HOURS_ONLY_REASONS = {
  LEGACY_APPROVAL: 'legacy_approval',
  UNREADABLE_SNAPSHOT: 'unreadable_snapshot',
  CARER_REMOVED: 'carer_removed',
} as const;
export type HoursOnlyReason =
  (typeof HOURS_ONLY_REASONS)[keyof typeof HOURS_ONLY_REASONS];

/** Hours, no money, ever. Carries no amount fields — by construction, not by convention. */
export const WeekEarningsHoursOnlySchema = z.object({
  status: z.literal(WEEK_EARNINGS_STATES.HOURS_ONLY),
  week_start: z.iso.date(),
  reason: z.enum(Object.values(HOURS_ONLY_REASONS)),
});

/**
 * Every arm of `WeekEarningsSchema`, plus `hours_only`.
 *
 * Built by spreading `WeekEarningsSchema.options` rather than re-listing the
 * arms, so the engine's output type and the wire's state type can never drift
 * apart: a fourth engine arm added later lands here automatically.
 */
export const WeekEarningsStateSchema = z.discriminatedUnion('status', [
  ...WeekEarningsSchema.options,
  WeekEarningsHoursOnlySchema,
]);

/**
 * A timesheet as the week screen reads it: every existing `TimesheetSchema`
 * field, plus a REQUIRED `earnings` state.
 *
 * Required, not optional-or-null: "we have no earnings for this week" is
 * always one of the named states above, and an absent field would reopen the
 * ambiguity the union exists to close.
 *
 * The four raw snapshot columns (`gross_minor`, `currency`, `earnings`,
 * `earnings_computed_at`) are deliberately NOT on the wire. They are storage,
 * and `earnings` here is the same data already parsed and state-tagged —
 * shipping both would let a client read the frozen jsonb without the
 * legacy/corrupt handling the server just did on its behalf.
 */
export const TimesheetWeekSchema = TimesheetSchema.extend({
  earnings: WeekEarningsStateSchema,
});

/**
 * `GET /timesheets/:id` / the week read envelope. `timesheet` is nullable
 * because no `timesheets` row exists until the week's first clock-out
 * (`timesheetCommandService.rollUpIntoTimesheet` creates it).
 */
export const TimesheetWeekResponseSchema = z.object({
  timesheet: TimesheetWeekSchema.nullable(),
});

export type WeekEarningsHoursOnly = z.infer<typeof WeekEarningsHoursOnlySchema>;
export type WeekEarningsStateResult = z.infer<typeof WeekEarningsStateSchema>;
export type TimesheetWeek = z.infer<typeof TimesheetWeekSchema>;
export type TimesheetWeekResponse = z.infer<typeof TimesheetWeekResponseSchema>;
