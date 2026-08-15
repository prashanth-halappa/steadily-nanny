// File: src/api/endpoints/termsProposals.ts
// Description: API endpoints and Zod response validation for terms proposals
// (D-35/D-38/D-49) — the negotiation that happens BEFORE any money exists.
// Wire shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/termsProposal.schema` — never
// redefined here.
//
// A proposal is a MESSAGE about money, never a record OF money: nothing here
// is priced client-side, and `weekly_equivalent_minor` arrives server-computed
// (see the shared schema's "FORBIDDEN" note — a naive `rate x hours` on this
// screen is the exact trust-killer §17 names).
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import type {
  AcceptTermsProposalRequest,
  CreateTermsProposalRequest,
  TermsProposal,
} from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import {
  AcceptTermsProposalRequestSchema,
  CreateTermsProposalRequestSchema,
  TermsProposalListResponseSchema,
  TermsProposalResponseSchema,
  TermsProposalSchema,
} from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { apiClient } from '@/src/api/client';

// Re-exported so domain-internal imports (`@/src/api/endpoints/termsProposals`)
// stay stable regardless of where the wire contract itself lives.
export type {
  AcceptTermsProposalRequest,
  CreateTermsProposalRequest,
  TermsProposal,
};

// --- Endpoint URLs ----------------------------------------------------------
export const termsProposalEndpoints = {
  list: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/terms-proposals`,
  current: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/terms-proposals/current`,
  // A COUNTER is this same POST with `supersedes_id` set — there is
  // deliberately no second endpoint (see `propose` below).
  create: (householdId: string, carerId: string) =>
    `/v1/households/${householdId}/carers/${carerId}/terms-proposals`,
  // Everything that acts on an EXISTING row is keyed by that row's id and
  // nothing else. The review screen is reached by proposal id from a push
  // deep link and an inbox row; it learns the (household, carer) pair FROM
  // the row it fetched, so requiring the pair in the URL would mean guessing
  // it before the read that supplies it. The server resolves the pair from
  // the row and gates on the caller's membership in it.
  getById: (proposalId: string) => `/v1/terms-proposals/${proposalId}`,
  accept: (proposalId: string) => `/v1/terms-proposals/${proposalId}/accept`,
  withdraw: (proposalId: string) =>
    `/v1/terms-proposals/${proposalId}/withdraw`,
  // B4 — the counterparty's refusal, distinct from withdraw.
  decline: (proposalId: string) => `/v1/terms-proposals/${proposalId}/decline`,
  viewed: (proposalId: string) => `/v1/terms-proposals/${proposalId}/viewed`,
} as const;

// `current` is the one read that legitimately has nothing to return: before
// anyone proposes, and after the last round is accepted or withdrawn, there is
// no live proposal. That is an empty state, not an error — same discipline as
// `payArrangementApi.getCurrent` (docs/11-MONEY.md §4). Built by overriding the
// SHARED envelope's one field rather than by hand-rolling a second object, so
// the envelope key can never drift from the contract.
const CurrentTermsProposalResponseSchema = TermsProposalResponseSchema.extend({
  terms_proposal: TermsProposalSchema.nullable(),
});

// --- API --------------------------------------------------------------------
export const termsProposalApi = {
  /**
   * The whole chain for one (household, carer) pair, newest first — every
   * round of the negotiation, including superseded ones. This IS §7.2's "How
   * we got here": a counter is a new row pointing at the one it answered
   * (`supersedes_id`), never an edit over it, so the list is the audit trail.
   */
  list: async (
    householdId: string,
    carerId: string
  ): Promise<TermsProposal[]> => {
    const response = await apiClient.get(
      termsProposalEndpoints.list(householdId, carerId)
    );
    const parsed = TermsProposalListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposals;
  },

  /**
   * One proposal by id — what the review screen (§7.2) opens on, reached from
   * a push deep link or an inbox row that knows only the id.
   */
  getById: async (proposalId: string): Promise<TermsProposal> => {
    const response = await apiClient.get(
      termsProposalEndpoints.getById(proposalId)
    );
    const parsed = TermsProposalResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposal;
  },

  /**
   * The proposal awaiting an answer, or `null` when nothing is on the table.
   * `null` is a normal response, NOT coerced to `undefined` and never thrown
   * — the "no proposal yet" empty state depends on telling it apart from
   * "still loading".
   */
  getCurrent: async (
    householdId: string,
    carerId: string
  ): Promise<TermsProposal | null> => {
    const response = await apiClient.get(
      termsProposalEndpoints.current(householdId, carerId)
    );
    const parsed = CurrentTermsProposalResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposal;
  },

  /**
   * Propose terms — or counter them, by setting `supersedes_id`. ONE endpoint
   * for both: a counter is not a different act, it is the same act pointing at
   * the round it answers, and a second route would be a second place for the
   * chain to be built wrong.
   *
   * The body is validated before it leaves the device (the `payArrangements`
   * discipline): the note cap and the `terms` money rules are the shared
   * schema's, so an over-long note or a negative rate never reaches the wire.
   * `direction`, `status` and `carer_id` are resolved server-side from the
   * caller's membership and are stripped here by Zod's default `.strip()`.
   */
  propose: async (
    householdId: string,
    carerId: string,
    input: CreateTermsProposalRequest
  ): Promise<TermsProposal> => {
    const validated = CreateTermsProposalRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      termsProposalEndpoints.create(householdId, carerId),
      validated.data
    );
    const parsed = TermsProposalResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposal;
  },

  /**
   * The binding act (§7.3): acceptance inserts a real `pay_arrangements` row
   * server-side under the accepting parent's own credentials.
   *
   * `responsibility_confirmed` is `z.literal(true)` in the shared schema, so
   * validating here means an acceptance without D-7's liability checkbox is
   * refused on the device — the server can never be handed a `false` to
   * interpret.
   */
  accept: async (
    proposalId: string,
    input: AcceptTermsProposalRequest
  ): Promise<TermsProposal> => {
    const validated = AcceptTermsProposalRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      termsProposalEndpoints.accept(proposalId),
      validated.data
    );
    const parsed = TermsProposalResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposal;
  },

  /**
   * Take back a proposal that has not been answered. NOT a delete — the row
   * goes `withdrawn` and stays in the chain, because "she withdrew it" is part
   * of how they got here.
   */
  withdraw: async (proposalId: string): Promise<TermsProposal> => {
    const response = await apiClient.post(
      termsProposalEndpoints.withdraw(proposalId)
    );
    const parsed = TermsProposalResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposal;
  },

  /**
   * B4 — the COUNTERPARTY's refusal. NOT a delete and NOT `withdraw`: the
   * row goes `declined` and stays in the chain, and `declined` is a distinct
   * fact from `withdrawn` (the author's own exit) — see the shared schema's
   * header.
   */
  decline: async (proposalId: string): Promise<TermsProposal> => {
    const response = await apiClient.post(
      termsProposalEndpoints.decline(proposalId)
    );
    const parsed = TermsProposalResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposal;
  },

  /**
   * The read receipt behind §5.3's "Viewed" row: the first time the review
   * screen mounted WITH DATA. Whether, never how many times — the server
   * stamps `viewed_at` once and ignores every later call.
   */
  markViewed: async (proposalId: string): Promise<TermsProposal> => {
    const response = await apiClient.post(
      termsProposalEndpoints.viewed(proposalId)
    );
    const parsed = TermsProposalResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.terms_proposal;
  },
};
