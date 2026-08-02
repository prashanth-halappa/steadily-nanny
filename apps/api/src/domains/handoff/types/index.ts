/**
 * Handoff domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { HandoffNote } from '../types'` following the
 * domain-anatomy convention.
 *
 * @module domains/handoff/types
 */
export type {
  CreateHandoffNoteInput,
  HandoffNote,
  HandoffNoteListResponse,
  HandoffPhase,
  HandoffRecap,
  HouseholdIdParam,
  LocalDateQuery,
  UpdateHandoffNoteInput,
} from '../schemas';
