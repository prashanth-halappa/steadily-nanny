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
import type { PayArrangementAck } from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import {
  CreatePayArrangementAckRequestSchema,
  PayArrangementAckListResponseSchema,
  PayArrangementAckSchema,
} from '@steadily-nanny/shared-types/schemas/payArrangementAck.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// Re-exported so domain-internal imports (`@/src/api/endpoints/payArrangements`)
// stay stable regardless of where the wire contract itself lives.
export type { CreatePayArrangementRequest, PayArrangement, PayArrangementAck };

// --- Endpoint URLs ----------------------------------------------------------
export const payArrangementEndpoints = {
  current: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements/current`,
  list: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements`,
  create: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements`,
  ack: (householdId: string, carerId: string, arrangementId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements/${arrangementId}/ack`,
  dissent: (householdId: string, carerId: string, arrangementId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements/${arrangementId}/dissent`,
  acks: (householdId: string, carerId: string, arrangementId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements/${arrangementId}/acks`,
  cancelScheduled: (
    householdId: string,
    carerId: string,
    arrangementId: string
  ) =>
    `/v1/households/${householdId}/carers/${carerId}/pay-arrangements/${arrangementId}/cancel-scheduled`,
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

  /**
   * D-31: "I've seen these terms." Carer-only, enforced server-side, and
   * idempotent — a second call returns the first row rather than erroring.
   * The recorded fact is that she SAW this version, never that she agreed to
   * it (D-41); the rendering discipline lives in the copy layer.
   */
  ack: async (
    householdId: string,
    carerId: string,
    arrangementId: string
  ): Promise<PayArrangementAck> => {
    const response = await apiClient.post(
      payArrangementEndpoints.ack(householdId, carerId, arrangementId)
    );
    const parsed = z
      .object({ pay_arrangement_ack: PayArrangementAckSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pay_arrangement_ack;
  },

  /**
   * D-45: "I don't agree with this." Blocks nothing — the terms stay in
   * effect. The note is her own words, capped at 280 chars by the SHARED
   * request schema, validated here so an over-long note never leaves the
   * device (the `create` discipline above).
   */
  dissent: async (
    householdId: string,
    carerId: string,
    arrangementId: string,
    note?: string
  ): Promise<PayArrangementAck> => {
    const validated = CreatePayArrangementAckRequestSchema.safeParse({ note });
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      payArrangementEndpoints.dissent(householdId, carerId, arrangementId),
      validated.data
    );
    const parsed = z
      .object({ pay_arrangement_ack: PayArrangementAckSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pay_arrangement_ack;
  },

  /** Every ack/dissent row for ONE arrangement version — §8.4's pill and
   * §8.5's history line both read from this. */
  listAcks: async (
    householdId: string,
    carerId: string,
    arrangementId: string
  ): Promise<PayArrangementAck[]> => {
    const response = await apiClient.get(
      payArrangementEndpoints.acks(householdId, carerId, arrangementId)
    );
    const parsed = PayArrangementAckListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.pay_arrangement_acks;
  },

  /**
   * D-16/§6: call off a change that has not started yet. NOT a delete — the
   * server appends a revert row, so the history keeps both the change and
   * the cancellation. Returns that appended row.
   */
  cancelScheduled: async (
    householdId: string,
    carerId: string,
    arrangementId: string
  ): Promise<PayArrangement> => {
    const response = await apiClient.post(
      payArrangementEndpoints.cancelScheduled(
        householdId,
        carerId,
        arrangementId
      )
    );
    const parsed = z
      .object({ pay_arrangement: PayArrangementSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.pay_arrangement;
  },
};
