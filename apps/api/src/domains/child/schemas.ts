/**
 * Child domain schemas — re-exported from the shared wire contract.
 *
 * The child wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/child.schema` — imported by BOTH the
 * API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (composite URL params for the nested
 * `/households/:householdId/children` mount) belong HERE, alongside this
 * re-export.
 *
 * @module domains/child/schemas
 */
import { z } from 'zod';

export type {
  Child,
  ChildListResponse,
  CreateChildInput,
  UpdateChildInput,
} from '@steadily-nanny/shared-types/schemas/child.schema';
export {
  ChildIdParamSchema,
  ChildListResponseSchema,
  ChildSchema,
  CreateChildSchema,
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

/** Param schema for the `/:childId`-shaped routes nested under a household. */
export const HouseholdChildParamsSchema = z.object({
  householdId: z.uuid(),
  childId: z.uuid(),
});
export type HouseholdChildParams = z.infer<typeof HouseholdChildParamsSchema>;
