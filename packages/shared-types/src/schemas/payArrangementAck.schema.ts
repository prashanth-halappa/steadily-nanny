/**
 * Pay arrangement acknowledgment + dissent wire contract (D-31, D-45).
 * @module packages/shared-types/src/schemas/payArrangementAck.schema
 *
 * Backing table: `pay_arrangement_acks` (supabase/migrations/081_pay_arrangement_acks.sql).
 *
 * Append-only, like every table in this domain: no update schema, no delete
 * — a change of mind is a NEW row for the NEXT arrangement version, never a
 * mutation of this one. See `docs/design/screens-pay-terms.md` §8.1/§8.3.1.
 *
 * State-word discipline (D-41): a 'seen' row renders as **"Seen by {name} on
 * {date}"**, never "Agreed" — "Agreed" is reserved for an accepted 3-O
 * proposal. This schema carries no rendered word; that discipline lives in
 * the mobile copy layer, not here.
 */

import { z } from 'zod';

/** pay_arrangement_acks.kind — mirrors the SQL `check` constraint exactly. */
export const PAY_ARRANGEMENT_ACK_KINDS = {
  /** D-31: "I've seen these terms." Never rendered as "Agreed" (D-41). */
  SEEN: 'seen',
  /** D-45: "I don't agree with this." Blocks nothing — a record, not a veto. */
  DISAGREED: 'disagreed',
} as const;
export type PayArrangementAckKind =
  (typeof PAY_ARRANGEMENT_ACK_KINDS)[keyof typeof PAY_ARRANGEMENT_ACK_KINDS];

/** The persisted entity as returned to clients. */
export const PayArrangementAckSchema = z.object({
  id: z.uuid(),
  arrangement_id: z.uuid(),
  carer_id: z.uuid(),
  kind: z.enum(Object.values(PAY_ARRANGEMENT_ACK_KINDS)),
  // 280 chars — §8.3.1's dissent Textarea. Always null on a 'seen' row;
  // optional user content on a 'disagreed' row, stored verbatim (it is her
  // own words, not system copy).
  note: z.string().max(280).nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/**
 * POST /households/:householdId/carers/:carerId/pay-arrangements/:arrangementId/ack
 * and .../dissent bodies. `arrangement_id`/`carer_id` come from the route —
 * the carer is always the AUTHENTICATED caller, never a client-supplied id
 * (spec §8.1: "only the carer the arrangement is for may write one").
 *
 * `kind` is NOT client-settable: which endpoint the client calls decides it,
 * the same "the client can't lie about which write it wants" shape as
 * `note.length` staying the schema's job and the KIND staying the route's.
 */
export const CreatePayArrangementAckRequestSchema = z.object({
  note: z.string().max(280).optional(),
});

/** List response envelope — every ack/dissent row for one arrangement. */
export const PayArrangementAckListResponseSchema = z.object({
  pay_arrangement_acks: z.array(PayArrangementAckSchema),
});

export type PayArrangementAck = z.infer<typeof PayArrangementAckSchema>;
export type CreatePayArrangementAckRequest = z.infer<
  typeof CreatePayArrangementAckRequestSchema
>;
export type PayArrangementAckListResponse = z.infer<
  typeof PayArrangementAckListResponseSchema
>;
