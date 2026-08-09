/**
 * Child and child-commitment wire contract.
 * @module packages/shared-types/src/schemas/child.schema
 *
 * Backing tables: `children`, `child_commitments`
 * (supabase/migrations/010_children.sql).
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly.
// =============================================================================

/** child_commitments.kind */
export const CHILD_COMMITMENT_KINDS = {
  PRESCHOOL: 'preschool',
  SCHOOL: 'school',
  ACTIVITY: 'activity',
  NAP: 'nap',
  OTHER: 'other',
} as const;
export type ChildCommitmentKind =
  (typeof CHILD_COMMITMENT_KINDS)[keyof typeof CHILD_COMMITMENT_KINDS];

// =============================================================================
// children
// =============================================================================

/** The persisted entity as returned to clients. */
export const ChildSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  name: z.string().min(1),
  // Age is always derived client-side from this — never stored as an age.
  birth_date: z.iso.date().nullable(),
  colour: z.string().nullable(),
  avatar_initial: z.string().nullable(),
  routine_notes: z.string().nullable(),
  // Soft delete — non-null means archived, not deleted.
  archived_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST body — what a client sends to create one. household_id comes from the route. */
export const CreateChildSchema = z.object({
  name: z.string().min(1, 'name is required'),
  birth_date: z.iso.date().optional(),
  colour: z.string().optional(),
  avatar_initial: z.string().optional(),
  routine_notes: z.string().optional(),
});

/** PATCH body — every field optional, but at least one must be present. */
export const UpdateChildSchema = CreateChildSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'at least one field is required' }
);

/** URL param validation for /children/:childId routes. */
export const ChildIdParamSchema = z.object({
  childId: z.uuid(),
});

/** List response envelope. */
export const ChildListResponseSchema = z.object({
  children: z.array(ChildSchema),
});

export type Child = z.infer<typeof ChildSchema>;
export type CreateChildInput = z.infer<typeof CreateChildSchema>;
export type UpdateChildInput = z.infer<typeof UpdateChildSchema>;
export type ChildListResponse = z.infer<typeof ChildListResponseSchema>;

// =============================================================================
// child_commitments
// =============================================================================

/** The persisted entity as returned to clients. */
export const ChildCommitmentSchema = z.object({
  id: z.uuid(),
  child_id: z.uuid(),
  household_id: z.uuid(),
  kind: z.enum(Object.values(CHILD_COMMITMENT_KINDS)),
  label: z.string().nullable(),
  // iCalendar RRULE, e.g. 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH'.
  rrule: z.string().min(1),
  // Nominal local wall-clock times, deliberately not instants — see migration
  // 010's header comment.
  start_time: z.iso.time(),
  end_time: z.iso.time(),
  starts_on: z.iso.date().nullable(),
  ends_on: z.iso.date().nullable(),
  exdates: z.array(z.iso.date()),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const ChildCommitmentInputSchema = z.object({
  kind: z.enum(Object.values(CHILD_COMMITMENT_KINDS)).optional(),
  label: z.string().min(1).optional().nullable(),
  rrule: z.string().min(1, 'rrule is required'),
  start_time: z.iso.time(),
  end_time: z.iso.time(),
  starts_on: z.iso.date().optional(),
  ends_on: z.iso.date().optional(),
  exdates: z.array(z.iso.date()).optional(),
});

/**
 * Wall-clock 'HH:MM' | 'HH:MM:SS' | 'HH:MM:SS.frac' — every shape
 * `z.iso.time()` accepts — as milliseconds since midnight, so two spellings of
 * the same time compare equal.
 *
 * A string compare cannot do that: `'09:30:00' > '09:30'` is true, so a
 * zero-length commitment written with mixed shapes read as a valid one. Same
 * family as the ISO-instant comparisons elsewhere in this package
 * (GOLDEN-FIXES #25) — one moment, several serialisations, compared as text.
 * Pinning an arbitrary date makes `Date.parse` do the normalising rather than
 * hand-rolling a pad-and-compare that would still have to special-case the
 * fractional part.
 */
const wallClockMs = (time: string): number => Date.parse(`1970-01-01T${time}Z`);

/**
 * POST body — what a client sends to create one. child_id comes from the
 * route. The end > start guard here is a light client-side mirror of the DB's
 * `child_commitments_time_order` check — the database remains authoritative.
 */
export const CreateChildCommitmentSchema = ChildCommitmentInputSchema.refine(
  data => wallClockMs(data.end_time) > wallClockMs(data.start_time),
  { message: 'end_time must be after start_time', path: ['end_time'] }
);

/**
 * PATCH body — every field optional, but at least one must be present, and if
 * BOTH times are present they must be ordered.
 *
 * Optional-guarded like `ParentEditShiftSchema` in the API's shift domain: a
 * PATCH carrying only one time is edited against a stored counterpart this
 * schema cannot see, so there is nothing here to compare it to and the DB's
 * `child_commitments_time_order` check remains the authority. Only the
 * both-present case is decidable at the wire, and it was previously not
 * decided at all — every ordering bug `CreateChildCommitmentSchema` rejects
 * could still be written by editing an existing commitment instead.
 */
export const UpdateChildCommitmentSchema = ChildCommitmentInputSchema.partial()
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  })
  .refine(
    data =>
      data.start_time === undefined ||
      data.end_time === undefined ||
      wallClockMs(data.end_time) > wallClockMs(data.start_time),
    { message: 'end_time must be after start_time', path: ['end_time'] }
  );

/** URL param validation for /child-commitments/:commitmentId routes. */
export const ChildCommitmentIdParamSchema = z.object({
  commitmentId: z.uuid(),
});

/** List response envelope. */
export const ChildCommitmentListResponseSchema = z.object({
  child_commitments: z.array(ChildCommitmentSchema),
});

export type ChildCommitment = z.infer<typeof ChildCommitmentSchema>;
export type CreateChildCommitmentInput = z.infer<
  typeof CreateChildCommitmentSchema
>;
export type UpdateChildCommitmentInput = z.infer<
  typeof UpdateChildCommitmentSchema
>;
export type ChildCommitmentListResponse = z.infer<
  typeof ChildCommitmentListResponseSchema
>;
