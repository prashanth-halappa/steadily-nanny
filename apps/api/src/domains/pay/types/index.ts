/**
 * Pay domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { PayArrangement } from '../types'` following the
 * domain-anatomy convention used by `domains/timesheet/types`.
 *
 * @module domains/pay/types
 */
export type {
  CreatePayArrangementRequest,
  HouseholdCarerParam,
  PayArrangement,
  PayArrangementListResponse,
} from '../schemas';
