/**
 * Shift domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { Shift } from '../types'` following the domain-anatomy
 * convention.
 *
 * @module domains/shift/types
 */
export type {
  HouseholdIdParam,
  HouseholdShiftIdParam,
  ParentEditShiftInput,
  Shift,
  ShiftChangeRequest,
  ShiftChild,
  ShiftEvent,
  ShiftEventListResponse,
  ShiftKind,
  ShiftListResponse,
  ShiftOrigin,
  ShiftRangeQuery,
  ShiftStatus,
} from '../schemas';
