/**
 * Payment (settlement) wire contract — the record that a week's wages were
 * actually paid, outside the app.
 * @module packages/shared-types/src/schemas/payment.schema
 *
 * Backing table: `payments` (supabase/migrations/067_payments.sql).
 *
 * The app computes and freezes what a week is WORTH (042's snapshot); this is
 * the other half of the loop — the parent recording that money moved. Money
 * moves by bank transfer or cash in the real world; a payment row is a fact
 * about that event, which is why the table is append-only (041/043's
 * contract) and why `CreatePaymentSchema` carries no currency: the server
 * stamps the timesheet's frozen currency so a payment can never be recorded
 * in a currency the week wasn't priced in.
 *
 * Partial payments are allowed — the service enforces
 * `sum(payments) <= gross_minor` per timesheet, refusing (never clamping)
 * anything over the frozen figure, per docs/11-MONEY.md.
 *
 * CORRECTIONS (D-20, migration 085). A ledger nobody can fix is a ledger
 * people stop trusting, and this sheet's own footer has always promised "a
 * correction is recorded as another payment" while 067's `amount_minor >= 1`
 * forbade exactly that row. A correction is a `kind: 'correction'` row with a
 * NEGATIVE `amount_minor` pointing at the payment it reverses. The original is
 * never edited — append-only is preserved in the strongest sense available.
 *
 * WHICH IS WHY `amount_minor` IS NOW SIGNED ON THE READ SCHEMA. Paid-to-date
 * is `sum(amount_minor)` across both kinds, everywhere it is computed (the
 * atomic gate inside 085's `record_timesheet_payment`, the CSV's
 * `paid_to_date_minor`, the mobile paid-state). One expression, no per-site
 * sign rule, and NEVER narrowed with `where kind = 'payment'` — 085's header
 * spells out what that breaks. The WRITE schemas stay positive: a parent
 * types "462.00" into a field labelled "Amount to reverse", and the server
 * negates it (`CreatePaymentCorrectionSchema` below).
 *
 * FLEET NOTE (§2.5's rule, and it applies here). A client built before this
 * change carries `amount_minor: z.int().min(1)` and will REFUSE a whole
 * payment list that contains a correction row. Corrections can only be created
 * from a build that has this schema, so the exposure is a household where one
 * parent has updated and the other has not. This is the same "a v2 WRITER
 * requires the reader shipped first" shape T3 recorded — carry it to Phase 5's
 * `min_supported_version`, do not solve it by narrowing this schema back.
 */

import { z } from 'zod';
import { MAX_MONEY_MINOR } from './payArrangement.schema';

/** Same ISO-4217 shape as `payArrangement.schema.ts` — three UPPERCASE letters. */
const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/** Free-text "how" (e.g. "Bank transfer", "Cash") — a note, not an enum. */
export const PAYMENT_METHOD_NOTE_MAX = 200;

/**
 * Why a payment was reversed ("recorded twice", "wrong week"). REQUIRED on a
 * correction: it is the only thing that makes a reversal readable a year
 * later, when the pair of rows is all anyone has.
 */
export const PAYMENT_CORRECTION_REASON_MAX = 200;

/**
 * What a row IS. Two values, and there will not be a third: an "adjustment"
 * or a "refund" is one of these two wearing a different word.
 */
export const PAYMENT_KINDS = {
  PAYMENT: 'payment',
  CORRECTION: 'correction',
} as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[keyof typeof PAYMENT_KINDS];

/** The persisted entity as returned to clients. */
export const PaymentSchema = z.object({
  id: z.uuid(),
  timesheet_id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: 033 discipline — a carer deleting her account leaves the
  // household's record of having paid her intact.
  carer_id: z.uuid().nullable(),
  // SIGNED — see the module doc. Positive on a payment, negative on a
  // correction. The bound is the same `MAX_MONEY_MINOR` on both sides, and
  // ZERO IS STILL REFUSED: relaxing the old `min(1)` to allow reversals must
  // not quietly admit a row for no money, which 085's
  // `check (amount_minor <> 0)` also forbids. Wire and table accept the same
  // set (`docs/11-MONEY.md` §1).
  amount_minor: z
    .int()
    .min(-MAX_MONEY_MINOR)
    .max(MAX_MONEY_MINOR)
    .refine(value => value !== 0, {
      message: 'amount_minor must not be zero',
    }),
  kind: z.enum([PAYMENT_KINDS.PAYMENT, PAYMENT_KINDS.CORRECTION]),
  // The payment this row reverses. NULL on a payment. One level only — a
  // correction is never itself correctable (085's function refuses it), so a
  // client rendering the pair never has to walk a chain.
  corrects_payment_id: z.uuid().nullable(),
  correction_reason: z.string().max(PAYMENT_CORRECTION_REASON_MAX).nullable(),
  currency: CurrencyCodeSchema,
  // The calendar day the parent says the money moved — a settlement date,
  // not an instant; there is no timezone to get wrong.
  paid_at: z.iso.date(),
  method_note: z.string().max(PAYMENT_METHOD_NOTE_MAX).nullable(),
  // Nullable: same 033 reasoning as carer_id, for the recording parent.
  recorded_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/**
 * POST body. No currency (server stamps the frozen one), no timesheet_id
 * (it's in the URL), no recorded_by (it's the caller).
 */
export const CreatePaymentSchema = z.object({
  amount_minor: z.int().min(1).max(MAX_MONEY_MINOR),
  paid_at: z.iso.date(),
  method_note: z.string().max(PAYMENT_METHOD_NOTE_MAX).optional(),
});

/**
 * POST body for a correction (D-20). No `corrects_payment_id` (it is in the
 * URL), no currency, no kind — the server stamps all three from the row it
 * locks, so a correction can never land on another household's payment or in
 * a currency the original was not recorded in.
 *
 * `amount_minor` IS A POSITIVE MAGNITUDE TO REVERSE, and the server negates
 * it. The sheet's field is labelled "Amount to reverse" and prefilled with the
 * original figure; asking a parent to type a minus sign to un-record a payment
 * is how you get a correction that adds money by accident. A reversal larger
 * than what is left of the original is REFUSED, never clamped, by 085's
 * function — with the figures it saw, so the sheet can say which ceiling was
 * hit (`docs/11-MONEY.md` §1).
 *
 * `reason` is required and trimmed: an empty-looking reason is the same defect
 * as no reason at all.
 */
export const CreatePaymentCorrectionSchema = z.object({
  amount_minor: z.int().min(1).max(MAX_MONEY_MINOR),
  paid_at: z.iso.date(),
  reason: z.string().trim().min(1).max(PAYMENT_CORRECTION_REASON_MAX),
});

/** List response envelope. */
export const PaymentListResponseSchema = z.object({
  payments: z.array(PaymentSchema),
});

export type Payment = z.infer<typeof PaymentSchema>;
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
export type CreatePaymentCorrectionInput = z.infer<
  typeof CreatePaymentCorrectionSchema
>;
export type PaymentListResponse = z.infer<typeof PaymentListResponseSchema>;
