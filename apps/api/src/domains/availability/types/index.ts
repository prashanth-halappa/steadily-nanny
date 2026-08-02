/**
 * Availability domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { CarerAvailability } from '../types'` following the
 * domain-anatomy convention.
 *
 * @module domains/availability/types
 */
export type {
  AnonymisedBusyBlock,
  AnonymisedBusyBlockListResponse,
  BusyBlockKind,
  BusyBlocksQuery,
  CarerAvailability,
  CarerAvailabilityListResponse,
  CarerEveningMode,
  CarerIdParam,
  CarerTimeOff,
  CarerTimeOffListResponse,
  CarerTimeOffStatus,
  CreateCarerAvailabilityInput,
  CreateCarerTimeOffInput,
  TimeOffIdParam,
  UpdateCarerAvailabilityInput,
  UpdateCarerTimeOffInput,
  UserIdParam,
} from '../schemas';
