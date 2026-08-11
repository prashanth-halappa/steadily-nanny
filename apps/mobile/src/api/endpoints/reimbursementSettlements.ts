// File: src/api/endpoints/reimbursementSettlements.ts
// Description: API endpoints and Zod validation for reimbursement
// settlements — the record that a household paid a carer BACK for what she
// spent (attention spec §4.2, D-14). Wire shapes come from the ONE shared
// source, `@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema`.
//
// THESE ARE NOT PAYMENTS. A settlement is excluded from gross, from payable
// minutes and from the payment ceiling because it is the family repaying
// money she already spent, not wages — which is why this module lives beside
// `payments.ts` rather than inside it. Do not merge the two, and do not sum a
// settlement into paid-to-date.
//
// `create` sends NO figure: `amount_minor` is computed server-side from the
// approved expense rows, so `CreateReimbursementSettlementSchema` carries
// only a carer, a week, a date and a note — and validating the body through
// it here also STRIPS any amount a caller invents before it can leave the
// device.

import type {
  CreateReimbursementSettlementInput,
  ReimbursementSettlement,
} from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
import {
  CreateReimbursementSettlementSchema,
  ReimbursementSettlementListResponseSchema,
  ReimbursementSettlementSchema,
} from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export { SETTLEMENT_NOTE_MAX } from '@steadily-nanny/shared-types/schemas/reimbursementSettlement.schema';
// Re-exported so domain-internal imports stay stable regardless of where the
// wire contract itself lives.
export type { CreateReimbursementSettlementInput, ReimbursementSettlement };

// --- Endpoint URLs ----------------------------------------------------------
export const reimbursementSettlementEndpoints = {
  forHousehold: (householdId: string) =>
    `/v1/households/${householdId}/reimbursement-settlements`,
} as const;

// --- API --------------------------------------------------------------------
export const reimbursementSettlementApi = {
  /** Every settlement recorded against one household-local week — a list,
   * not a row: a two-carer household settles two. */
  listForWeek: async (
    householdId: string,
    weekStart: string
  ): Promise<ReimbursementSettlement[]> => {
    const response = await apiClient.get(
      reimbursementSettlementEndpoints.forHousehold(householdId),
      { params: { weekStart } }
    );
    const parsed = ReimbursementSettlementListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.settlements;
  },

  /** Record that one carer's approved reimbursements for one week went back.
   * Parent only — server-gated. Append-only: there is no update and no
   * delete here (attention spec §4.2 — no correction path, deliberately). */
  create: async (
    householdId: string,
    input: CreateReimbursementSettlementInput
  ): Promise<ReimbursementSettlement> => {
    const validated = CreateReimbursementSettlementSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      reimbursementSettlementEndpoints.forHousehold(householdId),
      validated.data
    );
    const parsed = z
      .object({ settlement: ReimbursementSettlementSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.settlement;
  },
};
