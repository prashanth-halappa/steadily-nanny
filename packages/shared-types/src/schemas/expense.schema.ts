/**
 * Expense & mileage wire contract: reimbursements are not wages.
 * @module packages/shared-types/src/schemas/expense.schema
 *
 * Backing table: `expenses` (supabase/migrations/044_expenses.sql).
 *
 * Money is integer minor units + a sibling ISO-4217 `currency` code, never a
 * float — see `docs/11-MONEY.md` §1. `amount_minor` is pence (or the
 * smallest unit of whatever `currency` names) for `kind: 'expense'` rows;
 * for `kind: 'mileage'` rows it stays `null` until approval, when the
 * server computes `miles × the effective mileage rate` and freezes it —
 * same compute-live/freeze-at-approval discipline as earnings
 * (`docs/11-MONEY.md` §3). Expenses/mileage are excluded from gross pay and
 * overtime (`docs/11-MONEY.md` §6, "reimbursements are not wages").
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** expenses.kind */
export const EXPENSE_KINDS = {
  EXPENSE: 'expense',
  MILEAGE: 'mileage',
} as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[keyof typeof EXPENSE_KINDS];

/** expenses.status */
export const EXPENSE_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export type ExpenseStatus =
  (typeof EXPENSE_STATUSES)[keyof typeof EXPENSE_STATUSES];

/**
 * ISO-4217: exactly three UPPERCASE letters — the same shape
 * `payArrangement.schema.ts` pins (not `.length(3)`; see that module's
 * comment and `docs/11-MONEY.md` §1 for why).
 */
const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/**
 * `miles` backs a `numeric(6,1)` column: the DB stores at most ONE decimal
 * place. Pinning the same precision here, rather than accepting any finite
 * number, means a client that sends `12.567` gets a validation error at the
 * edge instead of the DB silently truncating it to `12.6` — the same class
 * of silent-lossy-conversion bug `docs/11-MONEY.md` §1 forbids for money,
 * applied to miles because the column has the identical shape. `.toFixed(1)`
 * round-trips exactly for the decimal literals this form actually produces
 * (a number keyboard entry, not an accumulated float), so comparing against
 * the original value is a reliable-enough precision check without pulling in
 * a decimal library for a single form field.
 */
const MAX_MILES = 99_999.9;

const MilesSchema = z
  .number()
  .positive()
  // numeric(6,1) is SIX significant digits with one after the point, so
  // 99999.9 is the largest storable value. Without this bound `123456.7`
  // passed the wire schema and died in Postgres as a numeric field overflow
  // — a 500 on a typo, where the honest answer is a 400 at the edge (Phase
  // 3/4 review, MINOR 11). The same reasoning as the precision refine below:
  // the wire accepts exactly what the column can hold, no more.
  .max(MAX_MILES, {
    message: 'miles must be at most 99999.9 (numeric(6,1))',
  })
  .refine(miles => Number(miles.toFixed(1)) === miles, {
    message: 'miles must have at most one decimal place (numeric(6,1))',
  });

// =============================================================================
// expenses
// =============================================================================

/** The persisted entity as returned to clients. */
export const ExpenseSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: a carer who deletes her account leaves this row behind for
  // the household's expense record — same ON DELETE SET NULL discipline as
  // pay_arrangements/pto_ledger (033_preserve_payroll_on_carer_deletion.sql).
  carer_id: z.uuid().nullable(),
  local_date: z.iso.date(),
  kind: z.enum(Object.values(EXPENSE_KINDS)),
  description: z.string().min(1),
  // Entered directly on 'expense' rows; null on a 'mileage' row until
  // approval, when the server computes and freezes it (see module JSDoc).
  amount_minor: z.int().min(0).nullable(),
  miles: MilesSchema.nullable(),
  currency: CurrencyCodeSchema,
  status: z.enum(Object.values(EXPENSE_STATUSES)),
  reviewed_by: z.uuid().nullable(),
  reviewed_at: z.iso.datetime({ offset: true }).nullable(),
  review_note: z.string().nullable(),
  // Snapshotted at insert time from the carer's profile — never derived on
  // read, so the name survives the profile being deleted.
  carer_display_name: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/**
 * POST /households/:householdId/carers/:carerId/expenses body —
 * `household_id`/`carer_id` come from the route, `carer_display_name` is
 * derived server-side, and `status`/`reviewed_*` have no write path here
 * (a fresh expense is always `pending`; review is a separate endpoint), so
 * none of the five appear.
 *
 * A DISCRIMINATED UNION on `kind`, mirroring 044's two implication CHECKs
 * at the wire level: `check (kind <> 'expense' or amount_minor is not
 * null)` becomes the 'expense' variant requiring `amount_minor`, and
 * `check (kind <> 'mileage' or miles is not null)` becomes the 'mileage'
 * variant requiring `miles`. Each variant is additionally `.strict()`, so
 * the OTHER kind's field is rejected as an unrecognized key rather than
 * silently stripped — a mileage payload must not be able to carry its own
 * `amount_minor` at all, because that amount is computed and frozen
 * server-side at approval (migration 044's third CHECK, "no indicative
 * amount before approval"); a client-supplied amount on a mileage row would
 * bypass that freeze entirely, one union arm away from a `.strip()` no-op.
 *
 * `currency` defaults to `'GBP'`, the house convention
 * (`CreatePayArrangementRequestSchema`); the server still asserts it
 * matches the effective arrangement's currency (`docs/11-MONEY.md` §9),
 * which depends on data this schema has no access to.
 */
export const CreateExpenseRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal(EXPENSE_KINDS.EXPENSE),
      local_date: z.iso.date(),
      description: z.string().min(1),
      amount_minor: z.int().min(0),
      currency: CurrencyCodeSchema.default('GBP'),
    })
    .strict(),
  z
    .object({
      kind: z.literal(EXPENSE_KINDS.MILEAGE),
      local_date: z.iso.date(),
      description: z.string().min(1),
      miles: MilesSchema,
      currency: CurrencyCodeSchema.default('GBP'),
    })
    .strict(),
]);

/**
 * PATCH .../expenses/:id body — a carer editing her OWN still-`pending` row
 * (`docs/11-MONEY.md` §8/§9, "pending-expense corrections"). Same fields,
 * same discriminated union, same per-kind field exclusivity as
 * `CreateExpenseRequestSchema` — an edit is shaped exactly like a create,
 * it just targets an existing row. There is deliberately no `status` field
 * on either: an edit never changes review state, only `ReviewExpenseRequestSchema`
 * (a parent-only action) does that. The `pending`-only gate itself is
 * service-side, since it depends on the row's current status.
 */
export const UpdateExpenseRequestSchema = CreateExpenseRequestSchema;

/**
 * POST .../expenses/:id/review body — parent-only. `status` is restricted
 * to the two terminal review outcomes (never `'pending'`, which is the
 * default a fresh row already has and not something a review action can
 * set it back to) — the same `z.enum([...])`-of-a-subset shape
 * `RespondToCoParentApprovalSchema` uses for its narrower status set.
 */
export const ReviewExpenseRequestSchema = z.object({
  status: z.enum([EXPENSE_STATUSES.APPROVED, EXPENSE_STATUSES.REJECTED]),
  review_note: z.string().optional(),
});

/** List response envelope. */
export const ExpenseListResponseSchema = z.object({
  expenses: z.array(ExpenseSchema),
});

export type Expense = z.infer<typeof ExpenseSchema>;
export type CreateExpenseRequest = z.infer<typeof CreateExpenseRequestSchema>;
export type UpdateExpenseRequest = z.infer<typeof UpdateExpenseRequestSchema>;
export type ReviewExpenseRequest = z.infer<typeof ReviewExpenseRequestSchema>;
export type ExpenseListResponse = z.infer<typeof ExpenseListResponseSchema>;
