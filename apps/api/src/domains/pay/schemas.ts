/**
 * Pay domain schemas — re-exported from the shared wire contract.
 *
 * The pay-arrangement wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/payArrangement.schema` — imported by
 * BOTH the API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable, exactly
 * as `domains/timesheet/schemas.ts` does.
 *
 * SERVER-ONLY schemas (URL params, query validation) belong HERE, alongside
 * the re-export — they must NOT go in the shared package, which is kept to
 * wire shapes only.
 *
 * @module domains/pay/schemas
 */
import { z } from 'zod';

export type {
  CreatePayArrangementRequest,
  PayArrangement,
  PayArrangementListResponse,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
export {
  CreatePayArrangementRequestSchema,
  PayArrangementListResponseSchema,
  PayArrangementSchema,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';

/**
 * URL param validation for
 * /households/:householdId/carers/:carerId/pay-arrangements (and its
 * `/current` sibling). Both ids are client-supplied, so both are validated as
 * uuids here and re-checked for membership in the service layer — the shape
 * check is not the authorization check (docs/11-MONEY.md §9).
 */
export const HouseholdCarerParamSchema = z.object({
  householdId: z.uuid(),
  carerId: z.uuid(),
});
export type HouseholdCarerParam = z.infer<typeof HouseholdCarerParamSchema>;
