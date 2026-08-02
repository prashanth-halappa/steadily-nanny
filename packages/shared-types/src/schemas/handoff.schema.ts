/**
 * Daily handoff notes wire contract (design flow 1i).
 * @module packages/shared-types/src/schemas/handoff.schema
 *
 * Backing table: `handoff_notes` (supabase/migrations/021_handoff_notes.sql).
 * No AI/voice — chips + optional free-text body only.
 */

import { z } from 'zod';

/** handoff_notes.phase */
export const HANDOFF_PHASES = {
  MORNING: 'morning',
  EVENING: 'evening',
} as const;
export type HandoffPhase = (typeof HANDOFF_PHASES)[keyof typeof HANDOFF_PHASES];

/** The persisted entity as returned to clients. */
export const HandoffNoteSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  local_date: z.iso.date(),
  author_id: z.uuid().nullable(),
  phase: z.enum(Object.values(HANDOFF_PHASES)),
  /** Structured chip labels, e.g. ["slept well", "ate well"]. */
  chips: z.array(z.string()),
  body: z.string().nullable(),
  moment_saved_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST body — household_id and author come from the route / session. */
export const CreateHandoffNoteSchema = z.object({
  local_date: z.iso.date(),
  phase: z.enum(Object.values(HANDOFF_PHASES)),
  chips: z.array(z.string()).default([]),
  body: z.string().optional(),
});

/** PATCH body — every field optional, but at least one must be present. */
export const UpdateHandoffNoteSchema = z
  .object({
    chips: z.array(z.string()).optional(),
    body: z.string().nullable().optional(),
    /** Set true to stamp moment_saved_at = now; false clears it. */
    save_moment: z.boolean().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  });

export const HandoffNoteIdParamSchema = z.object({
  handoffNoteId: z.uuid(),
});

export const HandoffNoteListResponseSchema = z.object({
  handoff_notes: z.array(HandoffNoteSchema),
});

/** Evening recap: all notes for one household local_date. */
export const HandoffRecapSchema = z.object({
  local_date: z.iso.date(),
  household_id: z.uuid(),
  notes: z.array(HandoffNoteSchema),
  chip_summary: z.array(z.string()),
});

export type HandoffNote = z.infer<typeof HandoffNoteSchema>;
export type CreateHandoffNoteInput = z.infer<typeof CreateHandoffNoteSchema>;
export type UpdateHandoffNoteInput = z.infer<typeof UpdateHandoffNoteSchema>;
export type HandoffNoteListResponse = z.infer<
  typeof HandoffNoteListResponseSchema
>;
export type HandoffRecap = z.infer<typeof HandoffRecapSchema>;
