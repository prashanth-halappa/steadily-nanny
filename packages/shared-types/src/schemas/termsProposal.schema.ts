/**
 * Terms-proposal wire contract (D-35, D-38, D-49).
 * @module packages/shared-types/src/schemas/termsProposal.schema
 *
 * Backing table: `terms_proposals` (supabase/migrations/092_terms_proposals.sql).
 * Spec: `docs/design/screens-onboarding-terms-proposal.md` §7, §9, §10.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * A proposal is a MESSAGE about money, never a record OF money. Nothing here
 * is priced, nothing feeds the earnings engine, and no timesheet can reference
 * one. The binding act is `accept`, and acceptance inserts a real
 * `pay_arrangements` row through the EXISTING `payArrangementCommandService`
 * under the accepting parent's own credentials — `WRITE_ROLES = {owner,
 * parent}` is untouched and the nanny never inserts an arrangement (D-35, §17).
 *
 * WHY `terms` IS THE PAY-ARRANGEMENT REQUEST, NOT TWENTY MIRRORED COLUMNS
 *
 * The payload is exactly a `CreatePayArrangementRequest`, validated by that
 * schema. Mirroring `pay_arrangements`' twenty-odd columns here would double
 * T17's field-by-field trap — a new pay term would need a second migration and
 * a second insert literal, and the day someone forgot one the proposal would
 * silently promise something the accepted arrangement did not carry. Reusing
 * the request schema makes "what she proposed is what he accepts" a property
 * of the type system.
 *
 * APPEND-ONLY IN SPIRIT
 *
 * A counter is a NEW ROW pointing at the one it answered (`supersedes_id`),
 * and the answered row goes `countered`. Nothing is ever edited over. That is
 * what makes §7.2's "How we got here" a true history rather than a UI
 * convenience, and it is the same promise T16 already makes on the pay screens.
 */

import { z } from 'zod';
import { CreatePayArrangementRequestSchema } from './payArrangement.schema';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/**
 * terms_proposals.status — the lifecycle in §10's state words.
 *
 * `proposed` -> `countered` (superseded by a new row) | `accepted` | `withdrawn`.
 * There is no `expired` and no round limit: two people negotiating is not a
 * workflow to time out, and a draft household generates no cron anyway (D-34).
 */
export const TERMS_PROPOSAL_STATUSES = {
  PROPOSED: 'proposed',
  COUNTERED: 'countered',
  ACCEPTED: 'accepted',
  WITHDRAWN: 'withdrawn',
} as const;
export type TermsProposalStatus =
  (typeof TERMS_PROPOSAL_STATUSES)[keyof typeof TERMS_PROPOSAL_STATUSES];

/**
 * terms_proposals.direction — which side authored THIS row.
 *
 * Not a role: a proposal always concerns exactly one carer, and the only
 * question a reader has is "did she send this, or did they?". §10 renders it
 * as the actor in every state line ("Countered by the Ahmeds · 11 Aug"),
 * which is `daylight-v2.md` §5.2's never-colour-only rule applied to a
 * distinction of meaning.
 */
export const TERMS_PROPOSAL_DIRECTIONS = {
  CARER: 'carer',
  PARENT: 'parent',
} as const;
export type TermsProposalDirection =
  (typeof TERMS_PROPOSAL_DIRECTIONS)[keyof typeof TERMS_PROPOSAL_DIRECTIONS];

/** The statuses that mean "this proposal is still live and awaiting an answer". */
export const OPEN_TERMS_PROPOSAL_STATUSES: readonly TermsProposalStatus[] = [
  TERMS_PROPOSAL_STATUSES.PROPOSED,
];

// =============================================================================
// terms_proposals
// =============================================================================

/** The persisted entity as returned to clients. */
export const TermsProposalSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  /**
   * Whose terms these are. Per-carer, always — a household with two nannies
   * has two independent negotiations and they must never see each other's
   * (D-21). Not a FK to `household_members` for the same "outlives the
   * membership" reason `pay_arrangement_acks.carer_id` gives.
   */
  carer_id: z.uuid(),
  /** Who wrote THIS row. Equals `carer_id` on a carer-authored proposal. */
  proposed_by: z.uuid(),
  direction: z.enum(Object.values(TERMS_PROPOSAL_DIRECTIONS)),
  status: z.enum(Object.values(TERMS_PROPOSAL_STATUSES)),
  /** The proposed terms — a full `CreatePayArrangementRequest` (see header). */
  terms: CreatePayArrangementRequestSchema,
  /** Her note, when she wrote one. Rendered under the terms card (§7.2). */
  note: z.string().nullable(),
  /**
   * The proposal this one answers, or null on the first round. A counter is
   * never an edit — this is the link that makes the chain a history.
   */
  supersedes_id: z.uuid().nullable(),
  /**
   * The invite this proposal arrived on, when it was cloned in by a
   * redemption (D-38). Null on an in-household proposal (§9). It is what lets
   * §5.3's "Sent to" row on the nanny's draft home say "Viewed" — the invite
   * she sent is how she identifies the family, and `viewed_at` below is the
   * fact she wants.
   */
  from_invite_id: z.uuid().nullable(),
  /**
   * Snapshot at insert, like 033 did for `pay_arrangements.carer_display_name`:
   * the history stays legible after the carer's profile is gone.
   */
  carer_display_name: z.string(),
  /**
   * SERVER-COMPUTED (`weeklyEquivalentMinor`, earningsService.ts:1064) and
   * attached at the wire edge, exactly as `pay_arrangements` does it.
   *
   * FORBIDDEN: no client anywhere in 3-O may compute `rate x hours`. At $28.00
   * with overtime after 40h, 50 guaranteed hours is $1,540.00 — a naive
   * multiply prints $1,400.00, which is the precise error David named as his
   * own trust-killer, on the screen where the contract is signed (§17, D23).
   * Null when there is no rate or no guaranteed hours: render nothing rather
   * than a figure we cannot stand behind.
   */
  weekly_equivalent_minor: z.int().min(0).nullable(),
  /**
   * First time the review screen mounted WITH DATA for this proposal (§5.3
   * "Viewed", §11 event 5). Whether, never how many times.
   */
  viewed_at: z.iso.datetime({ offset: true }).nullable(),
  /** When it left `proposed` — countered, accepted or withdrawn. */
  responded_at: z.iso.datetime({ offset: true }).nullable(),
  accepted_by: z.uuid().nullable(),
  /** The `pay_arrangements` row acceptance created. The audit join. */
  accepted_arrangement_id: z.uuid().nullable(),
  /**
   * D-7's liability checkbox, recorded ON the acceptance (§7.3). Together
   * with `accepted_by` and `responded_at` this makes D-31's acknowledgment
   * record literally "Marisol proposed Aug 10 · The Ahmeds agreed Aug 12" — a
   * better artifact than the one-sided ack D-31 originally described.
   */
  responsibility_confirmed: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/**
 * POST body — propose, or counter.
 *
 * `.strip()` (Zod's default for a plain object) is load-bearing here: the
 * client never picks its own `direction`, `status` or `carer_id`. The service
 * resolves all three from the caller's membership, because a body that could
 * set them is a body that could propose as somebody else.
 */
export const CreateTermsProposalRequestSchema = z.object({
  terms: CreatePayArrangementRequestSchema,
  note: z.string().max(280).optional(),
  /** Present when this is a counter; the named row goes `countered`. */
  supersedes_id: z.uuid().optional(),
});

/**
 * POST body for the binding act (§7.3).
 *
 * The confirmation is `z.literal(true)`, not `z.boolean()`: an acceptance
 * without the checkbox is not an acceptance, and refusing it at the wire
 * means the service can never be handed a `false` to interpret.
 */
export const AcceptTermsProposalRequestSchema = z.object({
  responsibility_confirmed: z.literal(true),
});

/** URL param validation for /terms-proposals/:proposalId routes. */
export const TermsProposalIdParamSchema = z.object({
  proposalId: z.uuid(),
});

/** List response envelope. */
export const TermsProposalListResponseSchema = z.object({
  terms_proposals: z.array(TermsProposalSchema),
});

/** Single-entity response envelope. */
export const TermsProposalResponseSchema = z.object({
  terms_proposal: TermsProposalSchema,
});

export type TermsProposal = z.infer<typeof TermsProposalSchema>;
export type CreateTermsProposalRequest = z.infer<
  typeof CreateTermsProposalRequestSchema
>;
export type AcceptTermsProposalRequest = z.infer<
  typeof AcceptTermsProposalRequestSchema
>;
export type TermsProposalListResponse = z.infer<
  typeof TermsProposalListResponseSchema
>;
export type TermsProposalResponse = z.infer<typeof TermsProposalResponseSchema>;
