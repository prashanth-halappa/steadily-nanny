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

/** time_entries.status */
export const TIME_ENTRY_STATUSES = {
  RUNNING: 'running',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  QUERIED: 'queried',
} as const;
export type TimeEntryStatus =
  (typeof TIME_ENTRY_STATUSES)[keyof typeof TIME_ENTRY_STATUSES];

/** timesheets.status */
export const TIMESHEET_STATUSES = {
  OPEN: 'open',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  QUERIED: 'queried',
} as const;
export type TimesheetStatus =
  (typeof TIMESHEET_STATUSES)[keyof typeof TIMESHEET_STATUSES];

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
  // Nullable: a carer can clock in on a day with no scheduled shift.
  shift_id: z.uuid().nullable(),
  clock_in_at: z.iso.datetime({ offset: true }).nullable(),
  clock_out_at: z.iso.datetime({ offset: true }).nullable(),
  break_minutes: z.int().min(0),
  // Frozen at clock-out — must not drift if the shift is later edited.
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
  // Monday, in the household's timezone — en-GB weeks start Monday.
  week_start: z.iso.date(),
  total_minutes: z.int(),
  status: z.enum(Object.values(TIMESHEET_STATUSES)),
  approved_by: z.uuid().nullable(),
  approved_at: z.iso.datetime({ offset: true }).nullable(),
  // "Query Thursday" — an approval escape hatch that names the disagreement.
  query_note: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST /timesheets/:id/query body. */
export const QueryTimesheetSchema = z.object({
  note: z.string().min(1, 'note is required'),
});

/** List response envelope. */
export const TimesheetListResponseSchema = z.object({
  timesheets: z.array(TimesheetSchema),
});

export type Timesheet = z.infer<typeof TimesheetSchema>;
export type QueryTimesheetInput = z.infer<typeof QueryTimesheetSchema>;
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
    /** Sum of every line EXCEPT `reimbursements` — wages only. */
    gross_minor: z.int().min(0),
    /** Summed separately and never part of gross (`docs/11-MONEY.md` §6). */
    reimbursements_minor: z.int().min(0),
    /** `worked` + `manual_adjustment`. The only basis for overtime. */
    worked_minutes: z.int().min(0),
    /** worked + `cancellation_paid` + PTO usage — the guaranteed-hours basis. */
    payable_minutes: z.int().min(0),
    /** Echoed so the top-up sub-line can read "to reach the agreed 40h". */
    guaranteed_minutes_per_week: z.int().min(0).nullable(),
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
