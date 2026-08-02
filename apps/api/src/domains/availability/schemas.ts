/**
 * Availability domain schemas — re-exported from the shared wire contract.
 *
 * The carer-availability / time-off / anonymised-busy-block wire shape lives
 * in ONE place — `@steadily-nanny/shared-types/schemas/availability.schema` —
 * imported by BOTH the API and the mobile app so the contract can never
 * drift. This module re-exports it so domain-internal imports (`../schemas`)
 * stay stable.
 *
 * SERVER-ONLY schemas (URL params, query validation) belong HERE, alongside
 * this re-export — they must NOT go in the shared package, which is kept to
 * wire shapes only. See the `InviteCodeParamSchema` precedent in
 * `domains/household/schemas.ts`.
 *
 * @module domains/availability/schemas
 */
import { z } from 'zod';

export type {
  AnonymisedBusyBlock,
  AnonymisedBusyBlockListResponse,
  BusyBlockKind,
  CarerAvailability,
  CarerAvailabilityListResponse,
  CarerEveningMode,
  CarerTimeOff,
  CarerTimeOffListResponse,
  CarerTimeOffStatus,
  CreateCarerAvailabilityInput,
  CreateCarerTimeOffInput,
  UpdateCarerAvailabilityInput,
  UpdateCarerTimeOffInput,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
export {
  AnonymisedBusyBlockListResponseSchema,
  AnonymisedBusyBlockSchema,
  BUSY_BLOCK_KINDS,
  CARER_EVENING_MODES,
  CARER_TIME_OFF_STATUSES,
  CarerAvailabilityIdParamSchema,
  CarerAvailabilityListResponseSchema,
  CarerAvailabilitySchema,
  CarerTimeOffIdParamSchema,
  CarerTimeOffListResponseSchema,
  CarerTimeOffSchema,
  CreateCarerAvailabilitySchema,
  CreateCarerTimeOffSchema,
  UpdateCarerAvailabilitySchema,
  UpdateCarerTimeOffSchema,
} from '@steadily-nanny/shared-types/schemas/availability.schema';

/** URL param validation for GET /availability/:userId. */
export const UserIdParamSchema = z.object({
  userId: z.uuid(),
});
export type UserIdParam = z.infer<typeof UserIdParamSchema>;

/** URL param validation for GET /availability/:carerId/busy. */
export const CarerIdParamSchema = z.object({
  carerId: z.uuid(),
});
export type CarerIdParam = z.infer<typeof CarerIdParamSchema>;

/**
 * Query validation for GET /availability/:carerId/busy?from=&to=. Server-only
 * URL validation, not a wire shape duplicate of AnonymisedBusyBlockSchema —
 * belongs here alongside the re-export, exactly like InviteCodeParamSchema in
 * the household domain's schemas.ts.
 */
export const BusyBlocksQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
export type BusyBlocksQuery = z.infer<typeof BusyBlocksQuerySchema>;

/**
 * URL param validation for DELETE /time-off/:id. Deliberately NOT the shared
 * `CarerTimeOffIdParamSchema` (which validates a `timeOffId` field) — this
 * route's path param is `:id`, so it needs its own field name.
 */
export const TimeOffIdParamSchema = z.object({
  id: z.uuid(),
});
export type TimeOffIdParam = z.infer<typeof TimeOffIdParamSchema>;
