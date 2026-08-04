// File: src/api/endpoints/payArrangements.ts
// Description: API endpoints and Zod response validation for pay
// arrangements (the effective-dated hourly rate + terms for one carer in one
// household). Wire shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/payArrangement.schema` — never
// redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import {
  CreatePayArrangementRequestSchema,
  PayArrangementListResponseSchema,
  PayArrangementSchema,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// Re-exported so domain-internal imports (`@/src/api/endpoints/payArrangements`)
// stay stable regardless of where the wire contract itself lives.
export type { CreatePayArrangementRequest, PayArrangement };

// --- Endpoint URLs ----------------------------------------------------------
export const payArrangementEndpoints = {
  current: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements/current`,
  list: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements`,
  create: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements`,
} as const;

// --- API --------------------------------------------------------------------
export const payArrangementApi = {
  /**
   * The arrangement effective today, or `null` when the carer has no
   * arrangement yet. `null` is a normal response, NOT coerced to
   * `undefined` and never thrown — the "no arrangement" empty state depends
   * on being able to tell "no rate set" apart from "still loading"
   * (docs/11-MONEY.md §4; see `PayArrangementController.getCurrent`).
   */
  getCurrent: async (
    householdId: string,
    carerId: string
  ): Promise<PayArrangement | null> => {
    const response = await apiClient.get(
      payArrangementEndpoints.current(householdId, carerId)
    );
    const parsed = z
      .object({ pay_arrangement: PayArrangementSchema.nullable() })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pay_arrangement;
  },

  /** The full append-only history for one carer, newest first. */
  getHistory: async (
    householdId: string,
    carerId: string
  ): Promise<PayArrangement[]> => {
    const response = await apiClient.get(
      payArrangementEndpoints.list(householdId, carerId)
    );
    const parsed = PayArrangementListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.pay_arrangements;
  },

  /**
   * Create a new arrangement — the only write in this domain (append-only;
   * no PATCH/DELETE anywhere, see `payArrangementRoutes.ts`). Parents only,
   * enforced server-side.
   */
  create: async (
    householdId: string,
    carerId: string,
    input: CreatePayArrangementRequest
  ): Promise<PayArrangement> => {
    const validated = CreatePayArrangementRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      payArrangementEndpoints.create(householdId, carerId),
      validated.data
    );
    const parsed = z
      .object({ pay_arrangement: PayArrangementSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pay_arrangement;
  },
};
