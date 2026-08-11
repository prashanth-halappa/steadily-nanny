// File: src/api/endpoints/payments.ts
// Description: API endpoints and Zod response validation for settlement
// payments (067) — the record that an APPROVED week's wages actually moved.
// Wire shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/payment.schema` — never redefined
// here.
//
// Deliberately no update and no remove: `payments` is append-only server-side
// (there is no PATCH and no DELETE route — see
// `apps/api/src/domains/pay/routes/paymentRoutes.ts`). A mistake is prevented
// at write time by the over-payment gate, and once written it is corrected by
// APPENDING a reversing row (`correct`, D-20 / migration 085) — never by
// editing history.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import type {
  CreatePaymentCorrectionInput,
  CreatePaymentInput,
  Payment,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import {
  CreatePaymentCorrectionSchema,
  CreatePaymentSchema,
  PaymentListResponseSchema,
  PaymentSchema,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export {
  PAYMENT_CORRECTION_REASON_MAX,
  PAYMENT_METHOD_NOTE_MAX,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
// Re-exported so domain-internal imports (`@/src/api/endpoints/payments`)
// stay stable regardless of where the wire contract itself lives.
export type { CreatePaymentCorrectionInput, CreatePaymentInput, Payment };

// --- Endpoint URLs ----------------------------------------------------------
export const paymentEndpoints = {
  /** Both the list GET and the create POST — one nested collection. */
  forTimesheet: (timesheetId: string) =>
    `/v1/timesheets/${timesheetId}/payments`,
  /** Read-only: every payment across every carer and week in one household. */
  forHousehold: (householdId: string) =>
    `/v1/households/${householdId}/payments`,
  /** D-20: appends a correcting row against ONE payment. A POST, not a PATCH
   * or a DELETE — the original is never touched. */
  corrections: (timesheetId: string, paymentId: string) =>
    `/v1/timesheets/${timesheetId}/payments/${paymentId}/corrections`,
} as const;

// --- API --------------------------------------------------------------------
export const paymentApi = {
  /**
   * `GET /timesheets/:timesheetId/payments` — every payment recorded against
   * one week, oldest first. Readable by the week's carer as well as a parent:
   * "have I been paid" is the nanny's question, not only the payer's.
   */
  list: async (timesheetId: string): Promise<Payment[]> => {
    const response = await apiClient.get(
      paymentEndpoints.forTimesheet(timesheetId)
    );
    const parsed = PaymentListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.payments;
  },

  /**
   * `GET /households/:householdId/payments` — the household's whole payment
   * history, across every carer and week, for the Payments screen. Same
   * envelope and schema as `list`, just scoped wider.
   */
  listForHousehold: async (householdId: string): Promise<Payment[]> => {
    const response = await apiClient.get(
      paymentEndpoints.forHousehold(householdId)
    );
    const parsed = PaymentListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.payments;
  },

  /**
   * `POST /timesheets/:timesheetId/payments` — record that money moved.
   * Parents only, approved weeks only, and `sum(payments) <= gross_minor` —
   * all three enforced server-side. The body carries no currency (the server
   * stamps the week's frozen one) and no `recorded_by` (it is the caller).
   *
   * Validating the body BEFORE the request is not belt-and-braces: it is what
   * keeps a zero/negative amount or a malformed `paid_at` from ever leaving
   * the device as a plausible-looking money write.
   */
  create: async (
    timesheetId: string,
    input: CreatePaymentInput
  ): Promise<Payment> => {
    const validated = CreatePaymentSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      paymentEndpoints.forTimesheet(timesheetId),
      validated.data
    );
    const parsed = z
      .object({ payment: PaymentSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.payment;
  },

  /**
   * `POST /timesheets/:id/payments/:paymentId/corrections` — reverse a payment
   * by APPENDING a negative row that points at it (D-20). The original keeps
   * its full amount forever.
   *
   * The body carries a POSITIVE magnitude to reverse; the server owns the sign
   * flip, and validating here BEFORE the request is what keeps a zero, a
   * negative, or an empty reason from ever leaving the device as a plausible
   * money write — the same reason `create` validates.
   */
  correct: async (
    timesheetId: string,
    paymentId: string,
    input: CreatePaymentCorrectionInput
  ): Promise<Payment> => {
    const validated = CreatePaymentCorrectionSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      paymentEndpoints.corrections(timesheetId, paymentId),
      validated.data
    );
    const parsed = z
      .object({ correction: PaymentSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.correction;
  },
};
