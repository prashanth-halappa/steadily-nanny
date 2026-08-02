/**
 * Handoff domain schemas — re-exported from the shared wire contract.
 *
 * The handoff-note wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/handoff.schema` — imported by BOTH
 * the API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (URL params, query validation) belong HERE, alongside
 * this re-export — they must NOT go in the shared package, which is kept to
 * wire shapes only. See the `HouseholdIdParamSchema` precedent in
 * `domains/shift/schemas.ts`.
 *
 * @module domains/handoff/schemas
 */
import { z } from 'zod';

export type {
  CreateHandoffNoteInput,
  HandoffNote,
  HandoffNoteListResponse,
  HandoffPhase,
  HandoffRecap,
  UpdateHandoffNoteInput,
} from '@steadily-nanny/shared-types/schemas/handoff.schema';
export {
  CreateHandoffNoteSchema,
  HANDOFF_PHASES,
  HandoffNoteIdParamSchema,
  HandoffNoteListResponseSchema,
  HandoffNoteSchema,
  HandoffRecapSchema,
  UpdateHandoffNoteSchema,
} from '@steadily-nanny/shared-types/schemas/handoff.schema';

/** URL param validation for the household-nested list/create/recap routes. */
export const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});
export type HouseholdIdParam = z.infer<typeof HouseholdIdParamSchema>;

/**
 * Query validation shared by the list and recap routes:
 * `?local_date=YYYY-MM-DD`.
 */
export const LocalDateQuerySchema = z.object({
  local_date: z.iso.date(),
});
export type LocalDateQuery = z.infer<typeof LocalDateQuerySchema>;
