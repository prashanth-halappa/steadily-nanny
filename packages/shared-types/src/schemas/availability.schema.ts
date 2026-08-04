/**
 * Carer availability, time off, household closures, and the anonymised
 * busy-block wire contract.
 * @module packages/shared-types/src/schemas/availability.schema
 *
 * Backing tables: `carer_availability`, `carer_time_off`
 * (supabase/migrations/011_availability.sql), `household_closures`
 * (035_household_closures.sql), plus the `timezone` / `week_starts_on`
 * columns on `user_profiles`. `AnonymisedBusyBlockSchema` additionally
 * mirrors the `v_busy_blocks` view (016_calendar_seams.sql) — read the
 * note on that export before touching it.
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** carer_availability.evening_mode */
export const CARER_EVENING_MODES = {
  NEVER: 'never',
  SOMETIMES: 'sometimes',
  ALWAYS: 'always',
} as const;
export type CarerEveningMode =
  (typeof CARER_EVENING_MODES)[keyof typeof CARER_EVENING_MODES];

/** carer_time_off.status */
export const CARER_TIME_OFF_STATUSES = {
  REQUESTED: 'requested',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
} as const;
export type CarerTimeOffStatus =
  (typeof CARER_TIME_OFF_STATUSES)[keyof typeof CARER_TIME_OFF_STATUSES];

/** The `kind` discriminator produced by the `v_busy_blocks` view. */
export const BUSY_BLOCK_KINDS = {
  OTHER_COMMITMENT: 'other_commitment',
  TIME_OFF: 'time_off',
  PERSONAL: 'personal',
} as const;
export type BusyBlockKind =
  (typeof BUSY_BLOCK_KINDS)[keyof typeof BUSY_BLOCK_KINDS];

// =============================================================================
// carer_availability
// =============================================================================

/** The persisted entity as returned to clients. */
export const CarerAvailabilitySchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  // 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow).
  weekday: z.int().min(0).max(6),
  is_available: z.boolean(),
  // Nominal local wall-clock times in the carer's own timezone.
  earliest_start: z.iso.time().nullable(),
  latest_finish: z.iso.time().nullable(),
  evening_mode: z.enum(Object.values(CARER_EVENING_MODES)),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const CarerAvailabilityInputSchema = z.object({
  weekday: z.int().min(0).max(6),
  is_available: z.boolean().optional(),
  earliest_start: z.iso.time().optional(),
  latest_finish: z.iso.time().optional(),
  evening_mode: z.enum(Object.values(CARER_EVENING_MODES)).optional(),
});

/**
 * PUT body — one row per weekday, unique-keyed on (user_id, weekday). The
 * server upserts on that key, so this shape is both the create and the
 * full-replace body.
 */
export const CreateCarerAvailabilitySchema = CarerAvailabilityInputSchema;

/** PATCH body — every field optional, but at least one must be present. */
export const UpdateCarerAvailabilitySchema =
  CarerAvailabilityInputSchema.partial().refine(
    data => Object.keys(data).length > 0,
    { message: 'at least one field is required' }
  );

/** URL param validation for /carer-availability/:availabilityId routes. */
export const CarerAvailabilityIdParamSchema = z.object({
  availabilityId: z.uuid(),
});

/** List response envelope. */
export const CarerAvailabilityListResponseSchema = z.object({
  carer_availability: z.array(CarerAvailabilitySchema),
});

export type CarerAvailability = z.infer<typeof CarerAvailabilitySchema>;
export type CreateCarerAvailabilityInput = z.infer<
  typeof CreateCarerAvailabilitySchema
>;
export type UpdateCarerAvailabilityInput = z.infer<
  typeof UpdateCarerAvailabilitySchema
>;
export type CarerAvailabilityListResponse = z.infer<
  typeof CarerAvailabilityListResponseSchema
>;

// =============================================================================
// carer_time_off
// =============================================================================

/** The persisted entity as returned to clients. */
export const CarerTimeOffSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  all_day: z.boolean(),
  // Shown to families verbatim if the carer writes one; optional.
  message: z.string().nullable(),
  status: z.enum(Object.values(CARER_TIME_OFF_STATUSES)),
  ical_uid: z.string(),
  sequence: z.int(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const CarerTimeOffInputSchema = z.object({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  all_day: z.boolean().optional(),
  message: z.string().optional(),
});

/**
 * POST body — what a client sends to create one. The end > start guard here
 * is a light client-side mirror of the DB's `carer_time_off_range` check —
 * the database remains authoritative.
 */
export const CreateCarerTimeOffSchema = CarerTimeOffInputSchema.refine(
  // Instant compare — lexicographic ISO strings break across offsets
  // (e.g. `…T11:00:00-01:00` vs `…T12:00:00+00:00`).
  data => Date.parse(data.ends_at) > Date.parse(data.starts_at),
  { message: 'ends_at must be after starts_at', path: ['ends_at'] }
);

/** PATCH body — every field optional, but at least one must be present. */
export const UpdateCarerTimeOffSchema = CarerTimeOffInputSchema.partial()
  .extend({
    status: z.enum(Object.values(CARER_TIME_OFF_STATUSES)).optional(),
    message: z.string().nullable().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  });

/** URL param validation for /carer-time-off/:timeOffId routes. */
export const CarerTimeOffIdParamSchema = z.object({
  timeOffId: z.uuid(),
});

/** List response envelope. */
export const CarerTimeOffListResponseSchema = z.object({
  carer_time_off: z.array(CarerTimeOffSchema),
});

/**
 * Create/update response — the row plus how many confirmed shifts the
 * range overlaps. The count is a total across households; per-household
 * breakdown is push-only and must never appear on this wire (privacy).
 */
export const CarerTimeOffMutationResponseSchema = z.object({
  carer_time_off: CarerTimeOffSchema,
  affected_shift_count: z.int().nonnegative(),
});

export type CarerTimeOff = z.infer<typeof CarerTimeOffSchema>;
export type CreateCarerTimeOffInput = z.infer<typeof CreateCarerTimeOffSchema>;
export type UpdateCarerTimeOffInput = z.infer<typeof UpdateCarerTimeOffSchema>;
export type CarerTimeOffListResponse = z.infer<
  typeof CarerTimeOffListResponseSchema
>;
export type CarerTimeOffMutationResponse = z.infer<
  typeof CarerTimeOffMutationResponseSchema
>;

// =============================================================================
// household_closures — parent-declared "we're away" (distinct from carer_time_off)
// =============================================================================

/** The persisted entity as returned to clients. */
export const HouseholdClosureSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  message: z.string().nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const HouseholdClosureInputSchema = z.object({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  message: z.string().optional(),
});

/** POST body — parent declares the household is closed for a range. */
export const CreateHouseholdClosureSchema = HouseholdClosureInputSchema.refine(
  // Instant compare — lexicographic ISO strings break across offsets
  // (e.g. `…T11:00:00-01:00` vs `…T12:00:00+00:00`).
  data => Date.parse(data.ends_at) > Date.parse(data.starts_at),
  { message: 'ends_at must be after starts_at', path: ['ends_at'] }
);

/** PATCH body — every field optional, but at least one must be present. */
export const UpdateHouseholdClosureSchema =
  HouseholdClosureInputSchema.partial()
    .extend({
      message: z.string().nullable().optional(),
    })
    .refine(data => Object.keys(data).length > 0, {
      message: 'at least one field is required',
    });

/** URL param validation for /closures/:closureId routes. */
export const HouseholdClosureIdParamSchema = z.object({
  closureId: z.uuid(),
});

/** List response envelope. */
export const HouseholdClosureListResponseSchema = z.object({
  household_closures: z.array(HouseholdClosureSchema),
});

export type HouseholdClosure = z.infer<typeof HouseholdClosureSchema>;
export type CreateHouseholdClosureInput = z.infer<
  typeof CreateHouseholdClosureSchema
>;
export type UpdateHouseholdClosureInput = z.infer<
  typeof UpdateHouseholdClosureSchema
>;
export type HouseholdClosureListResponse = z.infer<
  typeof HouseholdClosureListResponseSchema
>;

// =============================================================================
// AnonymisedBusyBlockSchema — the single most important type in the app
// =============================================================================
//
// A nanny works for several families, and one family must NEVER be able to
// learn anything about another. This is the wire shape for "when is this
// carer unavailable", and it is structurally incapable of carrying
// identifying data: EXACTLY `starts_at`, `ends_at`, `kind`. No household id,
// no household name, no child, no note, no title.
//
// This mirrors the five-column discipline of the `v_busy_blocks` DB view
// (supabase/migrations/016_calendar_seams.sql), which is itself commented
// "CRITICAL: this view exposes NO household id, household name, child, or
// note." Adding a field here is a PRIVACY REGRESSION — do not do it without
// re-reading that view's comment block first, and without the same scrutiny
// you'd give a change to the RLS policies themselves.

/** The wire shape for "when is this carer unavailable" — exactly 3 fields, on purpose. */
export const AnonymisedBusyBlockSchema = z.object({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  kind: z.enum(Object.values(BUSY_BLOCK_KINDS)),
});

/** List response envelope. */
export const AnonymisedBusyBlockListResponseSchema = z.object({
  busy_blocks: z.array(AnonymisedBusyBlockSchema),
});

export type AnonymisedBusyBlock = z.infer<typeof AnonymisedBusyBlockSchema>;
export type AnonymisedBusyBlockListResponse = z.infer<
  typeof AnonymisedBusyBlockListResponseSchema
>;

// NOTE: `user_profiles.timezone` / `.week_starts_on` (D29) are NOT modeled
// here. An earlier `UpdateUserTimeSettingsSchema` lived in this file —
// migration 011 added those two columns to `user_profiles` in the same
// migration that created this domain's `carer_availability`/`carer_time_off`
// tables, which is almost certainly how the schema ended up here — but
// `user_profiles` is owned by the `user` domain, not `availability`, and
// that schema had no repository/service/controller/route ANYWHERE for two
// waves running. Removed rather than left as a second, competing definition:
// the real one is `UpdateProfileSchema` in
// `apps/api/src/schemas/user.schema.ts`, which `PATCH /users/me` actually
// uses and which validates `timezone` against the real IANA database (this
// file's old version only checked non-empty-string).
