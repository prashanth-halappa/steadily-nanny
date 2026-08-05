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
 * POST .../time-off/:timeOffId/mark-paid body. `household_id`/`carer_id`
 * come from the URL, same as `CreatePayArrangementRequestSchema`.
 *
 * Minutes are freely chosen by the parent — an over-balance is a warning,
 * never a hard cap (TIER0-PLAN.md Phase 3, review finding 16) — so the only
 * shape constraint is "a positive number of minutes", `.min(1)`, not an
 * upper bound tied to the balance (that check is service-side, since it
 * depends on data this schema has no access to).
 */
export const MarkTimeOffPaidRequestSchema = z.object({
  time_off_id: z.uuid(),
  minutes: z.int().min(1),
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
