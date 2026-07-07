/**
 * Widget domain — Zod schemas + inferred types (the wire contract).
 *
 * This is the ONE place the widget wire shape is defined. The API validates
 * requests against these schemas; the mobile app validates responses against
 * them. Never redefine a `Widget` type in either app — import it from
 * `@yourapp/shared-types/schemas/widget.schema`.
 *
 * Wire shapes only: server-internal types (repository rows, DB records) stay in
 * the API's widget domain and are not exported here.
 *
 * @module schemas/widget.schema
 */
import { z } from 'zod';

/** The persisted entity as returned to clients. */
export const WidgetSchema = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});

/** POST body — create a widget. */
export const CreateWidgetSchema = z.object({
  name: z.string().min(1, 'name is required').max(80),
});

/** PATCH body — update a widget's mutable fields (at least one required). */
export const UpdateWidgetSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine(
    value => value.name !== undefined || value.description !== undefined,
    { message: 'at least one field is required' }
  );

/** URL param validation for /:widgetId routes. */
export const WidgetIdParamSchema = z.object({
  widgetId: z.uuid(),
});

/** Structured LLM output for generate-description. */
export const WidgetDescriptionSchema = z.object({
  description: z.string(),
  tags: z.array(z.string()),
});

// Inferred types — derive, never hand-write the duplicate.
export type Widget = z.infer<typeof WidgetSchema>;
export type CreateWidgetInput = z.infer<typeof CreateWidgetSchema>;
export type UpdateWidgetInput = z.infer<typeof UpdateWidgetSchema>;
export type WidgetDescription = z.infer<typeof WidgetDescriptionSchema>;
