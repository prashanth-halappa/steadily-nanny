// File: src/api/endpoints/pto.ts
// Description: API endpoints and Zod response validation for the household's
// PTO ledger (TIER0-CX-SPEC.md §5, TIER0-PLAN.md Phase 3). Wire shapes come
// from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/pto.schema` — never redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.
//
// `pto_ledger` is a HOUSEHOLD-scoped table that references a carer's
// cross-household `carer_time_off` row (docs/11-MONEY.md §5) — both
// `getBalance` and `getLedger` therefore take `householdId` AND `carerId`,
// while `markPaid` takes only `householdId`: the request body carries
// `time_off_id`, and the service resolves which carer that belongs to
// server-side (the same D12-class assertion pattern as
// `payArrangementCommandService.create`), so the client never sends a
// carer id the server would have to trust blindly.

import type {
  MarkTimeOffPaidRequest,
  PtoBalance,
  PtoLedgerEntry,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import {
  MarkTimeOffPaidRequestSchema,
  PtoBalanceSchema,
  PtoLedgerEntrySchema,
  PtoLedgerListResponseSchema,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// Re-exported so domain-internal imports (`@/src/api/endpoints/pto`) stay
// stable regardless of where the wire contract itself lives.
export type { MarkTimeOffPaidRequest, PtoBalance, PtoLedgerEntry };

// --- Endpoint URLs ----------------------------------------------------------
export const ptoEndpoints = {
  balance: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pto/balance`,
  ledger: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pto/ledger`,
  markPaid: (householdId: string) =>
    `/v1/households/${householdId}/pto/mark-paid`,
} as const;

// --- API --------------------------------------------------------------------
export const ptoApi = {
  /**
   * The carer's PTO balance for one calendar `year`, or `null` when the
   * effective arrangement has no `pto_entitlement_minutes_per_year` set —
   * "no entitlement configured", never coerced to a fabricated zero
   * (docs/11-MONEY.md §4's discipline, generalised to PTO). `balance_minutes`
   * on a non-null result may be NEGATIVE — a household can mark more paid
   * than the carer has accrued (warn, never block) — so it is passed
   * through exactly as the server computed it.
   */
  getBalance: async (
    householdId: string,
    carerId: string,
    year: number
  ): Promise<PtoBalance | null> => {
    const response = await apiClient.get(
      ptoEndpoints.balance(householdId, carerId),
      { params: { year } }
    );
    const parsed = z
      .object({ pto_balance: PtoBalanceSchema.nullable() })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pto_balance;
  },

  /** Every ledger row for one (household, carer) pair in one calendar
   * `year` — accrual, usage, and adjustment rows alike, append-only. */
  getLedger: async (
    householdId: string,
    carerId: string,
    year: number
  ): Promise<PtoLedgerEntry[]> => {
    const response = await apiClient.get(
      ptoEndpoints.ledger(householdId, carerId),
      { params: { year } }
    );
    const parsed = PtoLedgerListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pto_ledger_entries;
  },

  /**
   * Marks (or, when a usage row already exists for this time off, adds an
   * append-only correction to) `minutes` of one time-off request as paid.
   * Parent-gated server-side; minutes are freely chosen with an
   * over-balance WARNING, never a hard cap (TIER0-CX-SPEC.md §5.1, review
   * finding 16) — this client only guards the shape (`.min(1)`), never a
   * balance ceiling.
   */
  markPaid: async (
    householdId: string,
    input: MarkTimeOffPaidRequest
  ): Promise<PtoLedgerEntry> => {
    const validated = MarkTimeOffPaidRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      ptoEndpoints.markPaid(householdId),
      validated.data
    );
    const parsed = z
      .object({ pto_ledger_entry: PtoLedgerEntrySchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pto_ledger_entry;
  },
};
