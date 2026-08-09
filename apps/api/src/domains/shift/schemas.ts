/**
 * Shift domain schemas — re-exported from the shared wire contract.
 *
 * The shift/shift-children/shift-event wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/shift.schema` — imported by BOTH the
 * API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (URL params, query validation, and the narrow
 * parent-edit body below) belong HERE, alongside this re-export — they must
 * NOT go in the shared package, which is kept to wire shapes only. See the
 * `InviteCodeParamSchema` precedent in `domains/household/schemas.ts`.
 *
 * @module domains/shift/schemas
 */
import { z } from 'zod';

// Re-export the shared change-request wire contract — flows 1d/1e are
// implemented in `shiftChangeRequestCommandService` / routes below.
export type {
  CreateParentCoverInput,
  CreateShiftChangeRequestInput,
  RespondToShiftChangeRequestInput,
  Shift,
  ShiftChangeRequest,
  ShiftChangeRequestListResponse,
  ShiftChild,
  ShiftEvent,
  ShiftEventListResponse,
  ShiftKind,
  ShiftListResponse,
  ShiftOrigin,
  ShiftStatus,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
export {
  CreateParentCoverSchema,
  CreateShiftChangeRequestSchema,
  RespondToShiftChangeRequestSchema,
  SHIFT_KINDS,
  SHIFT_ORIGINS,
  SHIFT_STATUSES,
  ShiftChangeRequestIdParamSchema,
  ShiftChangeRequestListResponseSchema,
  ShiftChangeRequestSchema,
  ShiftEventListResponseSchema,
  ShiftEventSchema,
  ShiftIdParamSchema,
  ShiftListResponseSchema,
  ShiftSchema,
} from '@steadily-nanny/shared-types/schemas/shift.schema';

/** URL param validation for GET/PATCH /households/:householdId/shifts routes. */
export const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});
export type HouseholdIdParam = z.infer<typeof HouseholdIdParamSchema>;

/** URL param validation for GET /households/:householdId/shifts/:shiftId/events. */
export const HouseholdShiftIdParamSchema = z.object({
  householdId: z.uuid(),
  shiftId: z.uuid(),
});
export type HouseholdShiftIdParam = z.infer<typeof HouseholdShiftIdParamSchema>;

/** Query for GET /households/:householdId/day-thread?local_date=YYYY-MM-DD. */
export const DayThreadQuerySchema = z.object({
  local_date: z.iso.date(),
});
export type DayThreadQuery = z.infer<typeof DayThreadQuerySchema>;

/** Query validation for GET /households/:householdId/shifts?from=&to= — the primary calendar feed. */
export const ShiftRangeQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine(
    // Instant compare — lexicographic ISO strings break across offsets
    // (e.g. `…T11:00:00-01:00` vs `…T12:00:00+00:00`).
    data => Date.parse(data.to) > Date.parse(data.from),
    {
      message: 'to must be after from',
      path: ['to'],
    }
  );
export type ShiftRangeQuery = z.infer<typeof ShiftRangeQuerySchema>;

/**
 * PATCH /shifts/:shiftId body — deliberately narrower than the shared
 * `UpdateShiftSchema`: this endpoint is the parent-only "time change and/or
 * note" edit (see the service, which sets `origin = 'parent_proposed'`).
 * Accept/counter-offer/cancel/split are separate flows (1d/1e), out of scope
 * here, so `status`, `carer_id`, `kind`, and `reason` are deliberately absent
 * — a client cannot smuggle those through this route.
 */
export const ParentEditShiftSchema = z
  .object({
    starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }).optional(),
    note: z.string().nullable().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  })
  .refine(
    // Instant compare — lexicographic ISO strings break across offsets
    // (e.g. `…T11:00:00-01:00` vs `…T12:00:00+00:00`).
    data =>
      data.starts_at === undefined ||
      data.ends_at === undefined ||
      Date.parse(data.ends_at) > Date.parse(data.starts_at),
    { message: 'ends_at must be after starts_at', path: ['ends_at'] }
  );
export type ParentEditShiftInput = z.infer<typeof ParentEditShiftSchema>;

/**
 * POST /households/:householdId/shifts/extra — parent proposes a one-off
 * extra shift (flow 1d). Server sets `kind=extra`, `status=pending`,
 * `origin=parent_proposed`.
 */
export const CreateExtraShiftSchema = z
  .object({
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1),
    carer_id: z.uuid().optional(),
    child_ids: z.array(z.uuid()).optional(),
    note: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine(
    // Instant compare — lexicographic ISO strings break across offsets
    // (e.g. `…T11:00:00-01:00` vs `…T12:00:00+00:00`).
    data => Date.parse(data.ends_at) > Date.parse(data.starts_at),
    {
      message: 'ends_at must be after starts_at',
      path: ['ends_at'],
    }
  );
export type CreateExtraShiftInput = z.infer<typeof CreateExtraShiftSchema>;
