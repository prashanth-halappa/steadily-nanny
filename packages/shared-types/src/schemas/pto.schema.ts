/**
 * PTO ledger wire contract: paid time off is a household-scoped ledger, not
 * a flag on `carer_time_off`.
 * @module packages/shared-types/src/schemas/pto.schema
 *
 * Backing table: `pto_ledger` (supabase/migrations/043_pto_ledger.sql).
 *
 * `carer_time_off` deliberately carries no household reference
 * (`011_availability.sql`) — that absence is what makes cross-family
 * leakage of a nanny's time off structurally impossible. So "this time off
 * is paid" can never be a column on the time-off row itself: paid *by
 * whom*? Instead it's a `pto_ledger` row living in the household's own
 * scope, which *references* the time-off id (`docs/11-MONEY.md` §5).
 * Balance is the signed sum of a household's ledger rows.
 *
 * Money is not involved here — this is minutes, not currency — but the
 * append-only, snapshot-the-name discipline from `docs/11-MONEY.md` §1–2
 * still applies: `carer_display_name` is snapshotted at insert, and rows
 * are never updated or deleted (a correction is a new `adjustment` row).
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** pto_ledger.kind */
export const PTO_LEDGER_KINDS = {
  ACCRUAL: 'accrual',
  USAGE: 'usage',
  ADJUSTMENT: 'adjustment',
} as const;
export type PtoLedgerKind =
  (typeof PTO_LEDGER_KINDS)[keyof typeof PTO_LEDGER_KINDS];

/**
 * `pto_ledger.note` values the SERVER writes — stable machine keys, never
 * English prose (Phase 3/4 review, finding 16a).
 *
 * WHY KEYS. The ledger is append-only and permanent: a row written today is
 * still there in five years and can never be re-written. Store the sentence
 * "2026 annual PTO grant" and you have stored English in data — the day the
 * ledger history is localised, every row already written is orphaned, because
 * there is no path back from prose to a translatable key. This repo has
 * already paid for exactly this once: Wave 5's handoff chips stored English
 * display labels as row values (`handoff_notes.chips`), and the fix was
 * stable snake_case keys for precisely this reason (see PROJECT-STATUS.md's
 * Wave 5 notes and `domains/today/constants/handoffChips.ts`). The shape here
 * is that one, deliberately.
 *
 * NO PARAMETERS ARE STORED, because none are needed: the row itself already
 * carries everything a renderer wants. The grant's year is
 * `effective_date`'s year; a correction's size is its own `minutes`; the
 * direction is that value's sign. A key plus the row is a complete sentence
 * in any language.
 *
 * RENDERING (client side, not this package's job): look the key up in the
 * relevant i18n namespace and fall back to the raw value, the way
 * `handoffChipLabelKey` callers pass `{ defaultValue: chip }`. That fallback
 * is also what keeps user content readable: a note a PARENT typed on a
 * mark-paid is stored VERBATIM — it is user content, not system copy, and
 * the server never replaces it with a key — so it is simply an unknown
 * "key" and renders as itself.
 */
export const PTO_LEDGER_NOTE_KEYS = {
  /** The lazy annual grant (`ptoQueryService.ensureYearGranted`). */
  ANNUAL_GRANT: 'annual_grant',
  /** A parent changed the minutes already marked paid for a time off. */
  MARKED_PAID_ADJUSTED: 'marked_paid_adjusted',
  /** The carer cancelled a time off that had been marked paid. */
  CANCELLED_TIME_OFF_REVERSED: 'cancelled_time_off_reversed',
  /** The cancel landed WHILE the marking was being written (the SERIOUS 8 race). */
  CANCELLED_DURING_MARKING_REVERSED: 'cancelled_during_marking_reversed',
} as const;
export type PtoLedgerNoteKey =
  (typeof PTO_LEDGER_NOTE_KEYS)[keyof typeof PTO_LEDGER_NOTE_KEYS];

// =============================================================================
// pto_ledger
// =============================================================================

/**
 * The persisted entity as returned to clients.
 *
 * `minutes` is a SIGNED integer, never `.min(0)`: an `accrual` row is
 * positive (a grant), a `usage` row is negative (time taken), and an
 * `adjustment` row can be either (a reconciling correction, e.g. reversing
 * a usage row when a carer cancels time off that was already marked paid —
 * TIER0-PLAN.md Phase 3, review finding 9). The balance is the signed sum
 * of all three kinds, so the sign carries the meaning; a naive
 * `z.int().min(0)` here would silently make usage rows impossible to
 * represent. Zero is rejected because the SQL carries
 * `check (minutes <> 0)` — a zero-minute ledger entry records nothing and
 * is never a legitimate grant, usage, or correction.
 */
export const PtoLedgerEntrySchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: a carer who deletes her account leaves this row behind for
  // the household's PTO history — same ON DELETE SET NULL discipline as
  // pay_arrangements/timesheets (033_preserve_payroll_on_carer_deletion.sql).
  carer_id: z.uuid().nullable(),
  kind: z.enum(Object.values(PTO_LEDGER_KINDS)),
  minutes: z.int().refine(minutes => minutes !== 0, {
    message: 'minutes must not be 0 — see the check (minutes <> 0) constraint',
  }),
  effective_date: z.iso.date(),
  // Usage rows only — the FK to a cross-household carer_time_off row. Null
  // on accrual/adjustment rows, which are not tied to a specific time off.
  time_off_id: z.uuid().nullable(),
  // Snapshotted at insert time from the carer's profile — never derived on
  // read, so the name survives the profile being deleted.
  carer_display_name: z.string(),
  // EITHER one of `PTO_LEDGER_NOTE_KEYS` (a system-written row) OR a note a
  // parent typed herself (user content, stored verbatim). Left as a plain
  // string rather than a union: the ledger is append-only, so a row written
  // by an older or newer server must still parse — narrowing this to the
  // current key set would make yesterday's rows unreadable the day a key is
  // added. Renderers translate a known key and show anything else as-is.
  note: z.string().nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/**
 * The balance read for one carer's PTO year — `ptoQueryService.balance`.
 *
 * `entitlement_minutes` is nullable: null when the effective arrangement
 * sets no `pto_entitlement_minutes_per_year` (no entitlement configured,
 * not zero). `accrued_minutes` and `used_minutes` are each reported as
 * non-negative totals (the sum of, respectively, the ledger's positive
 * accrual/adjustment credits and the absolute value of its usage debits) —
 * they are aggregate counters, not signed ledger rows, so `.min(0)` is
 * correct here even though `PtoLedgerEntrySchema.minutes` is signed.
 *
 * `balance_minutes` may be NEGATIVE: a household can mark more time paid
 * than the carer has accrued (the product warns, per the CX spec's
 * warn-never-block stance, but never blocks — TIER0-PLAN.md Phase 3,
 * review finding 16), so the schema must allow it rather than clamping at
 * zero and hiding the overage from the parent.
 */
export const PtoBalanceSchema = z.object({
  carer_id: z.uuid(),
  household_id: z.uuid(),
  year: z.int(),
  entitlement_minutes: z.int().min(0).nullable(),
  accrued_minutes: z.int().min(0),
  used_minutes: z.int().min(0),
  balance_minutes: z.int(),
});

/**
 * POST /households/:householdId/pto/mark-paid body. `household_id` comes
 * from the URL and the carer is DERIVED from the time off's `user_id`, never
 * accepted as a param — see `ptoRoutes.ts`, which is the authority on the
 * address. (An earlier version of this comment named a
 * `.../time-off/:timeOffId/mark-paid` route that has never existed; the
 * `time_off_id` travels in the body, below.)
 *
 * `minutes` is the TOTAL this household pays for the time off, not a delta:
 * re-submitting a different number appends a correcting `adjustment` row for
 * the difference, and the ledger's netted sum is what balance and the
 * earnings engine both read (`ptoCommandService.markTimeOffPaid`).
 *
 * ZERO IS VALID and means "unpay this entirely" — a full reversal of the
 * netted total (TIER0-PLAN.md Phase 3/4 review, BLOCKER 3). It is not a
 * zero-minute ledger row: the SQL still carries `check (minutes <> 0)` and
 * the service writes the reversing amount, never a zero. `.min(0)` rather
 * than the old `.min(1)` is what lets the mark-paid sheet's own "remove"
 * path reach the server at all.
 *
 * Minutes are otherwise freely chosen by the parent — an over-balance is a
 * warning, never a hard cap (TIER0-PLAN.md Phase 3, review finding 16) — so
 * there is no upper bound tied to the balance (that check is service-side,
 * since it depends on data this schema has no access to).
 */
export const MarkTimeOffPaidRequestSchema = z.object({
  time_off_id: z.uuid(),
  minutes: z.int().min(0),
  note: z.string().optional(),
});

/** List response envelope. */
export const PtoLedgerListResponseSchema = z.object({
  pto_ledger_entries: z.array(PtoLedgerEntrySchema),
});

export type PtoLedgerEntry = z.infer<typeof PtoLedgerEntrySchema>;
export type PtoBalance = z.infer<typeof PtoBalanceSchema>;
export type MarkTimeOffPaidRequest = z.infer<
  typeof MarkTimeOffPaidRequestSchema
>;
export type PtoLedgerListResponse = z.infer<typeof PtoLedgerListResponseSchema>;
