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
 */

import { z } from 'zod';
import { MAX_MONEY_MINOR } from './payArrangement.schema';

/** Same ISO-4217 shape as `payArrangement.schema.ts` — three UPPERCASE letters. */
const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/** Free-text "how" (e.g. "Bank transfer", "Cash") — a note, not an enum. */
export const PAYMENT_METHOD_NOTE_MAX = 200;

/** The persisted entity as returned to clients. */
export const PaymentSchema = z.object({
  id: z.uuid(),
  timesheet_id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: 033 discipline — a carer deleting her account leaves the
  // household's record of having paid her intact.
  carer_id: z.uuid().nullable(),
  amount_minor: z.int().min(1).max(MAX_MONEY_MINOR),
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

/** List response envelope. */
export const PaymentListResponseSchema = z.object({
  payments: z.array(PaymentSchema),
});

export type Payment = z.infer<typeof PaymentSchema>;
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
export type PaymentListResponse = z.infer<typeof PaymentListResponseSchema>;
