/**
 * Child domain schemas — re-exported from the shared wire contract.
 *
 * The child/child-commitment wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/child.schema` — imported by BOTH the
 * API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (composite URL params for the nested
 * `/households/:householdId/children` and
 * `/households/:householdId/children/:childId/commitments` mounts) belong
 * HERE, alongside this re-export.
 *
 * `ChildCommitmentSchema` and its Create/Update/List siblings back the
 * `child_commitments` table (`supabase/migrations/010_children.sql`) — flow
 * 1g ("Per-child coverage & gaps"), wired up by
 * `childCommitmentRepository`/`childCommitmentQueryService`/
 * `childCommitmentCommandService`/`childCommitmentRoutes`+`commitmentRoutes`
 * and consumed by `uncoveredCareService`.
 *
 * @module domains/child/schemas
 */
import { z } from 'zod';

export type {
  Child,
  ChildCommitment,
  ChildCommitmentListResponse,
  ChildListResponse,
  CreateChildCommitmentInput,
  CreateChildInput,
  UpdateChildCommitmentInput,
  UpdateChildInput,
} from '@steadily-nanny/shared-types/schemas/child.schema';
export {
  CHILD_COMMITMENT_KINDS,
  ChildCommitmentIdParamSchema,
  ChildCommitmentListResponseSchema,
  ChildCommitmentSchema,
  ChildIdParamSchema,
  ChildListResponseSchema,
  ChildSchema,
  CreateChildCommitmentSchema,
  CreateChildSchema,
  UpdateChildCommitmentSchema,
  UpdateChildSchema,
} from '@steadily-nanny/shared-types/schemas/child.schema';

/**
 * Param schema for the household-scoped list/create routes
 * (`/households/:householdId/children`). `:householdId` arrives via
 * `mergeParams` from the parent mount in `routes/index.ts`.
 */
export const HouseholdIdOnlyParamSchema = z.object({
  householdId: z.uuid(),
});

/**
 * Param schema for the `/:childId`-shaped routes nested under a household,
 * AND for the commitment list/create routes nested one level deeper
 * (`/households/:householdId/children/:childId/commitments`) — same two
 * ids, reused rather than duplicated.
 */
export const HouseholdChildParamsSchema = z.object({
  householdId: z.uuid(),
  childId: z.uuid(),
});
export type HouseholdChildParams = z.infer<typeof HouseholdChildParamsSchema>;
