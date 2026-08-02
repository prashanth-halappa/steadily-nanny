/**
 * Child domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { Child } from '../types'` following the domain-anatomy
 * convention.
 *
 * @module domains/child/types
 */
export type {
  Child,
  ChildCommitment,
  ChildCommitmentListResponse,
  ChildListResponse,
  CreateChildCommitmentInput,
  CreateChildInput,
  UpdateChildCommitmentInput,
  UpdateChildInput,
} from '../schemas';
