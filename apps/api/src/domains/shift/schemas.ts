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

// `ShiftChangeRequest` is re-exported below for the ONE thing that already
// reads the table (`scheduleShiftRepository.hasChangeRequests`, the
// re-materialisation guard). Its Create/Respond/List schema siblings are
// deliberately NOT re-exported — flows 1d/1e are "not started" per
// PROJECT-STATUS.md, so there is no repository/service/controller/route for
// change requests at all; see `ParentEditShiftSchema` below and
// `../services/shiftCommandService.ts`'s header for why. Also see
// `supabase/migrations/015_shifts.sql`'s `shift_change_requests` section.
export type {
  Shift,
  ShiftChangeRequest,
  ShiftChild,
  ShiftEvent,
  ShiftEventListResponse,
  ShiftKind,
  ShiftListResponse,
  ShiftOrigin,
  ShiftStatus,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
export {
  SHIFT_KINDS,
  SHIFT_ORIGINS,
  SHIFT_STATUSES,
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

/** Query validation for GET /households/:householdId/shifts?from=&to= — the primary calendar feed. */
export const ShiftRangeQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine(data => data.to > data.from, {
    message: 'to must be after from',
    path: ['to'],
  });
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
    note: z.string().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  })
  .refine(
    data =>
      data.starts_at === undefined ||
      data.ends_at === undefined ||
      data.ends_at > data.starts_at,
    { message: 'ends_at must be after starts_at', path: ['ends_at'] }
  );
export type ParentEditShiftInput = z.infer<typeof ParentEditShiftSchema>;
