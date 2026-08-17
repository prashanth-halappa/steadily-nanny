/**
 * Reimbursement settlement wire contract — the record that a household paid a
 * carer BACK for what she spent (D-14, gap P7).
 * @module packages/shared-types/src/schemas/reimbursementSettlement.schema
 *
 * Backing table: `reimbursement_settlements`
 * (supabase/migrations/086_reimbursement_settlements.sql).
 *
 * THESE ARE NOT PAYMENTS, and the separate file is part of saying so. An
 * approved reimbursement is excluded from gross, from payable minutes and from
 * the payment ceiling (`earningsService.ts`, the REIMBURSEMENTS branch)
 * because it is the family repaying money she already spent, not wages. Do not
 * merge this with `payment.schema.ts`, and do not sum a settlement into
 * paid-to-date — the two look like the same shape and are not the same fact.
 *
 * ONE ROW = ONE CARER'S APPROVED REIMBURSEMENTS FOR ONE HOUSEHOLD-LOCAL WEEK.
 * The client sends no figure: `amount_minor` is computed server-side from the
 * approved expense rows at settlement time, so there is nothing to spoof and
 * no way to file a repayment for an amount nobody agreed. That is why
 * `CreateReimbursementSettlementSchema` carries only a date and a note.
 *
 * Append-only, like every money table since 041. There is deliberately NO
 * correction path here (attention spec §4.2 — YAGNI); 085's exists one table
 * over if one is ever needed.
 */

import { z } from 'zod';
import { MAX_MONEY_MINOR } from './payArrangement.schema';

/** Same ISO-4217 shape as every other money schema — three UPPERCASE letters. */
const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/** Free-text "how it went back" ("Cash on Friday") — a note, not an enum. */
export const SETTLEMENT_NOTE_MAX = 200;

/** The persisted entity as returned to clients. */
export const ReimbursementSettlementSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: 033 discipline — a carer deleting her account leaves the
  // household's record of having repaid her intact.
  carer_id: z.uuid().nullable(),
  week_start: z.iso.date(),
  amount_minor: z.int().min(1).max(MAX_MONEY_MINOR),
  currency: CurrencyCodeSchema,
  // The calendar day the money went back — a settlement date, not an instant.
  settled_at: z.iso.date(),
  note: z.string().max(SETTLEMENT_NOTE_MAX).nullable(),
  recorded_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/**
 * POST body. `carer_id` and `week_start` say WHICH week is being settled —
 * they identify the claims, and the household is in the URL, so neither can
 * reach outside the caller's own household. NO AMOUNT and NO CURRENCY: the
 * server sums the approved expense rows for that carer-week and stamps the
 * household's currency, so a body cannot record a repayment for a figure
 * nobody agreed (the same "nothing from the body describes the money" rule
 * `CreatePaymentSchema` follows).
 */
export const CreateReimbursementSettlementSchema = z.object({
  carer_id: z.uuid(),
  week_start: z.iso.date(),
  settled_at: z.iso.date(),
  note: z.string().max(SETTLEMENT_NOTE_MAX).optional(),
});

/**
 * List response envelope. A list, not a single row: the week view asks for
 * "the settlements on this week" and a two-carer household has two.
 */
export const ReimbursementSettlementListResponseSchema = z.object({
  settlements: z.array(ReimbursementSettlementSchema),
});

/**
 * One household-local week whose approved reimbursements have not been
 * settled yet — the aggregate the Today inbox `reimbursement_owed` item needs.
 * Integer minor units only, always with a sibling `currency` field; a week with
 * nothing owed is simply absent from the list.
 */
export const UnsettledReimbursementWeekSchema = z.object({
  // NULLABLE, on the same 033 discipline as `ReimbursementSettlementSchema`
  // above: the claims are still owed after she deletes her account, and the
  // client `safeParse`s this list and THROWS on the first bad row — so a
  // required uuid here does not hide one departed carer, it blanks the whole
  // Today inbox for the household.
  carer_id: z.uuid().nullable(),
  // 058's membership stamp — the identity that survives the account, and the
  // only thing that keeps two departed carers in one week apart. Nullable +
  // optional for the same reason as every other row schema carrying it: a
  // pre-058 row has none, and a stored response replayed to an older API must
  // still parse.
  household_member_id: z.uuid().nullable().optional(),
  // The snapshot the client labels the row with once `carer_id` is gone.
  carer_display_name: z.string(),
  week_start: z.iso.date(),
  amount_minor: z.int().min(1).max(MAX_MONEY_MINOR),
  currency: CurrencyCodeSchema,
});

export const UnsettledReimbursementListResponseSchema = z.object({
  weeks: z.array(UnsettledReimbursementWeekSchema),
});

export type ReimbursementSettlement = z.infer<
  typeof ReimbursementSettlementSchema
>;
export type UnsettledReimbursementWeek = z.infer<
  typeof UnsettledReimbursementWeekSchema
>;
export type CreateReimbursementSettlementInput = z.infer<
  typeof CreateReimbursementSettlementSchema
>;
export type ReimbursementSettlementListResponse = z.infer<
  typeof ReimbursementSettlementListResponseSchema
>;
