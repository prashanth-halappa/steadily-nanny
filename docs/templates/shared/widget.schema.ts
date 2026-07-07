/**
 * Shared contract skeleton — Zod schemas + inferred types for the `<feature>` entity.
 * Lives at: packages/shared-types/src/schemas/<feature>.schema.ts
 *
 * This is the ONE place the wire shape is defined. The API validates requests
 * against these; the mobile app validates responses against these. Never redefine
 * a `Widget` type in either app — import it from here.
 *
 * Add to packages/shared-types/src/index.ts (or rely on the `./schemas/*` subpath
 * export already declared in package.json):
 *   export * from './schemas/widget.schema';
 */

import { z } from 'zod';

/** The persisted entity as returned to clients. */
export const WidgetSchema = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  name: z.string().min(1),
  created_at: z.string(), // ISO timestamp
});

/** POST body — what a client sends to create one. */
export const CreateWidgetSchema = z.object({
  name: z.string().min(1, 'name is required'),
});

/** URL param validation for /:widgetId routes. */
export const WidgetIdParamSchema = z.object({
  widgetId: z.uuid(),
});

/** List response envelope. */
export const WidgetListResponseSchema = z.object({
  widgets: z.array(WidgetSchema),
});

// Inferred types — derive, never hand-write the duplicate.
export type Widget = z.infer<typeof WidgetSchema>;
export type CreateWidgetInput = z.infer<typeof CreateWidgetSchema>;
export type WidgetListResponse = z.infer<typeof WidgetListResponseSchema>;
