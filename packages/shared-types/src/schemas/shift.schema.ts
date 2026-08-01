/**
 * Shift, coverage, change-request, and day-thread wire contract.
 * @module packages/shared-types/src/schemas/shift.schema
 *
 * Backing tables: `shifts`, `shift_children`, `shift_change_requests`,
 * `shift_events` (supabase/migrations/015_shifts.sql).
 *
 * TIME MODEL: `starts_at` / `ends_at` are absolute UTC instants — the only
 * truth. `timezone` records the zone the shift was AUTHORED in, so the
 * original wall-clock intent ("8am") survives even if the household later
 * moves. See the header comment in migration 015 before touching this.
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** shifts.kind */
export const SHIFT_KINDS = {
  RECURRING: 'recurring',
  EXTRA: 'extra',
  COVER: 'cover',
  PARENT_COVER: 'parent_cover',
} as const;
export type ShiftKind = (typeof SHIFT_KINDS)[keyof typeof SHIFT_KINDS];

/** shifts.status */
export const SHIFT_STATUSES = {
  DRAFT: 'draft',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
} as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[keyof typeof SHIFT_STATUSES];

/** shifts.origin */
export const SHIFT_ORIGINS = {
  SYSTEM_GENERATED: 'system_generated',
  PARENT_PROPOSED: 'parent_proposed',
  NANNY_COUNTERED: 'nanny_countered',
  PARENT_COVER: 'parent_cover',
} as const;
export type ShiftOrigin = (typeof SHIFT_ORIGINS)[keyof typeof SHIFT_ORIGINS];

/** shift_change_requests.kind */
export const SHIFT_CHANGE_REQUEST_KINDS = {
  TIME_CHANGE: 'time_change',
  CANCEL: 'cancel',
  COUNTER_OFFER: 'counter_offer',
  SPLIT: 'split',
  HANDOVER: 'handover',
} as const;
export type ShiftChangeRequestKind =
  (typeof SHIFT_CHANGE_REQUEST_KINDS)[keyof typeof SHIFT_CHANGE_REQUEST_KINDS];

/** shift_change_requests.status */
export const SHIFT_CHANGE_REQUEST_STATUSES = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
  SUPERSEDED: 'superseded',
} as const;
export type ShiftChangeRequestStatus =
  (typeof SHIFT_CHANGE_REQUEST_STATUSES)[keyof typeof SHIFT_CHANGE_REQUEST_STATUSES];

// =============================================================================
// shifts
// =============================================================================

/** The persisted entity as returned to clients. */
export const ShiftSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: "Thu — nobody yet" is a real, displayable state.
  carer_id: z.uuid().nullable(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1),
  // Maintained by a DB trigger from starts_at/timezone — never client-set.
  local_date: z.iso.date(),
  kind: z.enum(Object.values(SHIFT_KINDS)),
  status: z.enum(Object.values(SHIFT_STATUSES)),
  source_pattern_id: z.uuid().nullable(),
  origin: z.enum(Object.values(SHIFT_ORIGINS)),
  is_short_notice: z.boolean(),
  note: z.string().nullable(),
  reason: z.string().nullable(),
  cancelled_at: z.iso.datetime({ offset: true }).nullable(),
  cancelled_by: z.uuid().nullable(),
  cancellation_paid: z.boolean(),
  cancellation_message: z.string().nullable(),
  ical_uid: z.string(),
  sequence: z.int(),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const ShiftInputSchema = z.object({
  carer_id: z.uuid().optional(),
  starts_at: z.iso.datetime({ offset: true }).optional(),
  ends_at: z.iso.datetime({ offset: true }).optional(),
  timezone: z.string().min(1).optional(),
  kind: z.enum(Object.values(SHIFT_KINDS)).optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * POST body — what a client sends to create one. `local_date` is
 * trigger-derived; `status`/`origin` are decided server-side by whichever
 * flow creates the shift (pattern materialisation, a parent proposal, a
 * nanny counter), never taken verbatim from the client.
 */
export const CreateShiftSchema = ShiftInputSchema.extend({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1),
}).refine(data => data.ends_at > data.starts_at, {
  message: 'ends_at must be after starts_at',
  path: ['ends_at'],
});

/**
 * PATCH body — every field optional, but at least one must be present.
 * Cancellation is its own action (see `shift_change_requests`), so
 * cancellation fields are deliberately absent here.
 */
export const UpdateShiftSchema = ShiftInputSchema.extend({
  status: z.enum(Object.values(SHIFT_STATUSES)).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'at least one field is required',
});

/** URL param validation for /shifts/:shiftId routes. */
export const ShiftIdParamSchema = z.object({
  shiftId: z.uuid(),
});

/** List response envelope. */
export const ShiftListResponseSchema = z.object({
  shifts: z.array(ShiftSchema),
});

export type Shift = z.infer<typeof ShiftSchema>;
export type CreateShiftInput = z.infer<typeof CreateShiftSchema>;
export type UpdateShiftInput = z.infer<typeof UpdateShiftSchema>;
export type ShiftListResponse = z.infer<typeof ShiftListResponseSchema>;

// =============================================================================
// shift_children
// =============================================================================
// NULL start/end means the whole shift; both null or both set is the only
// legal pairing (DB `shift_children_time_pairing` check).

/** The persisted entity as returned to clients. */
export const ShiftChildSchema = z.object({
  id: z.uuid(),
  shift_id: z.uuid(),
  child_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }).nullable(),
  ends_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/** POST body — what a client sends to create one. */
export const CreateShiftChildSchema = z
  .object({
    child_id: z.uuid(),
    starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    data => (data.starts_at === undefined) === (data.ends_at === undefined),
    {
      message: 'starts_at and ends_at must both be set or both omitted',
      path: ['ends_at'],
    }
  );

/** URL param validation for /shift-children/:shiftChildId routes. */
export const ShiftChildIdParamSchema = z.object({
  shiftChildId: z.uuid(),
});

/** List response envelope. */
export const ShiftChildListResponseSchema = z.object({
  shift_children: z.array(ShiftChildSchema),
});

export type ShiftChild = z.infer<typeof ShiftChildSchema>;
export type CreateShiftChildInput = z.infer<typeof CreateShiftChildSchema>;
export type ShiftChildListResponse = z.infer<
  typeof ShiftChildListResponseSchema
>;

// =============================================================================
// shift_change_requests
// =============================================================================
// The propose/accept model inverts here: a carer can counter-offer. No
// generic Update schema — a change request is responded to (accept/decline,
// see RespondToShiftChangeRequestSchema) or withdrawn, both narrower actions
// than an arbitrary PATCH.

/** The persisted entity as returned to clients. */
export const ShiftChangeRequestSchema = z.object({
  id: z.uuid(),
  shift_id: z.uuid(),
  requested_by: z.uuid().nullable(),
  kind: z.enum(Object.values(SHIFT_CHANGE_REQUEST_KINDS)),
  proposed_starts_at: z.iso.datetime({ offset: true }).nullable(),
  proposed_ends_at: z.iso.datetime({ offset: true }).nullable(),
  // Free text shown verbatim to the other side.
  message: z.string().nullable(),
  status: z.enum(Object.values(SHIFT_CHANGE_REQUEST_STATUSES)),
  responded_by: z.uuid().nullable(),
  responded_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST body — what a client sends to open one. */
export const CreateShiftChangeRequestSchema = z
  .object({
    kind: z.enum(Object.values(SHIFT_CHANGE_REQUEST_KINDS)),
    proposed_starts_at: z.iso.datetime({ offset: true }).optional(),
    proposed_ends_at: z.iso.datetime({ offset: true }).optional(),
    message: z.string().optional(),
  })
  .refine(
    data =>
      data.proposed_starts_at === undefined ||
      data.proposed_ends_at === undefined ||
      data.proposed_ends_at > data.proposed_starts_at,
    {
      message: 'proposed_ends_at must be after proposed_starts_at',
      path: ['proposed_ends_at'],
    }
  );

/** POST body for accepting or declining a pending change request. */
export const RespondToShiftChangeRequestSchema = z.object({
  status: z.enum([
    SHIFT_CHANGE_REQUEST_STATUSES.ACCEPTED,
    SHIFT_CHANGE_REQUEST_STATUSES.DECLINED,
  ]),
  message: z.string().optional(),
});

/** URL param validation for /shift-change-requests/:changeRequestId routes. */
export const ShiftChangeRequestIdParamSchema = z.object({
  changeRequestId: z.uuid(),
});

/** List response envelope. */
export const ShiftChangeRequestListResponseSchema = z.object({
  shift_change_requests: z.array(ShiftChangeRequestSchema),
});

export type ShiftChangeRequest = z.infer<typeof ShiftChangeRequestSchema>;
export type CreateShiftChangeRequestInput = z.infer<
  typeof CreateShiftChangeRequestSchema
>;
export type RespondToShiftChangeRequestInput = z.infer<
  typeof RespondToShiftChangeRequestSchema
>;
export type ShiftChangeRequestListResponse = z.infer<
  typeof ShiftChangeRequestListResponseSchema
>;

// =============================================================================
// shift_events — append-only day thread
// =============================================================================
// The API alone writes rows here (append-only audit trail — see migration
// 015's comment: "an audit trail that can be edited is not an audit trail").
// This is a read-only wire shape; there is no Create/Update schema for clients.

/** The persisted entity as returned to clients. */
export const ShiftEventSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable so day-level events (a gap raised, a cover week rearranged) can
  // be recorded against a date with no single shift.
  shift_id: z.uuid().nullable(),
  local_date: z.iso.date(),
  actor_id: z.uuid().nullable(),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.iso.datetime({ offset: true }),
});

/** List response envelope. */
export const ShiftEventListResponseSchema = z.object({
  shift_events: z.array(ShiftEventSchema),
});

export type ShiftEvent = z.infer<typeof ShiftEventSchema>;
export type ShiftEventListResponse = z.infer<
  typeof ShiftEventListResponseSchema
>;
