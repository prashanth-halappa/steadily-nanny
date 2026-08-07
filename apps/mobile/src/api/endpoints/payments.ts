// File: src/api/endpoints/payments.ts
// Description: API endpoints and Zod response validation for settlement
// payments (067) — the record that an APPROVED week's wages actually moved.
// Wire shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/payment.schema` — never redefined
// here.
//
// Two calls and deliberately no third: `payments` is append-only server-side
// (there is no PATCH and no DELETE route — see
// `apps/api/src/domains/pay/routes/paymentRoutes.ts`), so this module has no
// update/remove to wrap. A mistake is prevented at write time by the
// over-payment gate, never corrected by editing history.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import type {
  CreatePaymentInput,
  Payment,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import {
  CreatePaymentSchema,
  PaymentListResponseSchema,
  PaymentSchema,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export { PAYMENT_METHOD_NOTE_MAX } from '@steadily-nanny/shared-types/schemas/payment.schema';
// Re-exported so domain-internal imports (`@/src/api/endpoints/payments`)
// stay stable regardless of where the wire contract itself lives.
export type { CreatePaymentInput, Payment };

// --- Endpoint URLs ----------------------------------------------------------
export const paymentEndpoints = {
  /** Both the list GET and the create POST — one nested collection. */
  forTimesheet: (timesheetId: string) =>
    `/v1/timesheets/${timesheetId}/payments`,
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
};
