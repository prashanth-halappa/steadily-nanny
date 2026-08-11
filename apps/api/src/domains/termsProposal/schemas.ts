/**
 * Terms-proposal domain schemas — re-exported from the shared wire contract.
 *
 * The proposal wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/termsProposal.schema` — imported by
 * BOTH apps so the contract can never drift. This module re-exports it so
 * domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (URL params) belong HERE, alongside the re-export —
 * they must NOT go in the shared package, which is kept to wire shapes only.
 * Same convention as `domains/timesheet/schemas.ts`.
 *
 * @module domains/termsProposal/schemas
 */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { z } from 'zod';

export type {
  AcceptTermsProposalRequest,
  CreateTermsProposalRequest,
  TermsProposal,
  TermsProposalDirection,
  TermsProposalListResponse,
  TermsProposalResponse,
  TermsProposalStatus,
} from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
export {
  AcceptTermsProposalRequestSchema,
  CreateTermsProposalRequestSchema,
  TERMS_PROPOSAL_DIRECTIONS,
  TERMS_PROPOSAL_STATUSES,
  TermsProposalIdParamSchema,
  TermsProposalListResponseSchema,
  TermsProposalResponseSchema,
  TermsProposalSchema,
} from '@steadily-nanny/shared-types/schemas/termsProposal.schema';

/**
 * The PERSISTED row, which is the wire shape minus the one field that is not
 * a column: `weekly_equivalent_minor` is computed at the wire edge by
 * `withWeeklyEquivalent` (see the controller), never stored and never
 * returned by a service. Keeping the two types distinct is what stops a
 * future read path from serving a proposal with the figure silently absent.
 */
export type TermsProposalRow = Omit<TermsProposal, 'weekly_equivalent_minor'>;

/**
 * URL param validation for
 * `/households/:householdId/carers/:carerId/terms-proposals`.
 *
 * A proposal is per-carer ALWAYS (D-21), so the carer is in the path rather
 * than the body — and both ids being client-supplied on a write is exactly
 * the D12/D13/D14 shape, so the shape check here is NOT the authorization
 * check. Both services re-verify membership at the top of every method.
 */
export const HouseholdCarerParamSchema = z.object({
  householdId: z.uuid(),
  carerId: z.uuid(),
});
export type HouseholdCarerParam = z.infer<typeof HouseholdCarerParamSchema>;

/** The same, plus the `:proposalId` the accept/withdraw/viewed routes carry. */
export const HouseholdCarerProposalParamSchema =
  HouseholdCarerParamSchema.extend({
    proposalId: z.uuid(),
  });
export type HouseholdCarerProposalParam = z.infer<
  typeof HouseholdCarerProposalParamSchema
>;
