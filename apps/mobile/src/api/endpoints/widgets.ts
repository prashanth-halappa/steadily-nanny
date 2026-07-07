// File: src/api/endpoints/widgets.ts
// API endpoints, Zod response validation, and types for the example "widget"
// domain — the mobile half of the kitchen-sink feature.
//
// Every network call goes through the shared `apiClient` (the integrator-owned
// seam) and unwraps the standard success envelope at `response.data.data` before
// validating the payload with Zod, so contract drift surfaces here, not deep in a
// screen. NEVER import this module from a component — use the hooks that wrap it.
//
// The widget WIRE SHAPE (Widget / CreateWidgetInput) comes from ONE place —
// `@yourapp/shared-types/schemas/widget.schema` — shared by the API and this
// app, so the contract can never drift. Only the response ENVELOPE wrappers and
// the mobile-only usage/send shapes are defined locally here.
//
// NOTE: the shared WidgetSchema is stricter than the old local copy (uuid ids,
// non-empty name), so response validation is intentionally tighter now.
//
// TEMPLATE: widget UI copy is inline English — consider i18n for a real feature.

import {
  type CreateWidgetInput,
  type Widget,
  WidgetSchema,
} from '@yourapp/shared-types/schemas/widget.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// Re-export the shared wire types so consumers (hooks) import them from here.
export type { CreateWidgetInput, Widget };

// --- Endpoint URLs ----------------------------------------------------------
export const widgetEndpoints = {
  list: '/v1/widgets',
  create: '/v1/widgets',
  byId: (id: string) => `/v1/widgets/${id}`,
  generateDescription: (id: string) => `/v1/widgets/${id}/generate-description`,
  notify: (id: string) => `/v1/widgets/${id}/notify`,
  // Reused subscription endpoint — the widget quota lives under widget_creation.
  usage: '/v1/subscription/usage',
} as const;

// --- Zod schemas ------------------------------------------------------------
// Response ENVELOPE wrappers composed around the shared WidgetSchema (envelopes
// are a client-side concern and stay local).
const WidgetListSchema = z.object({ widgets: z.array(WidgetSchema) });
const WidgetEnvelopeSchema = z.object({ widget: WidgetSchema });

/** Per-feature usage counter from /v1/subscription/usage. */
const UsageStatusSchema = z.object({
  feature: z.string(),
  used: z.number(),
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
  resetsAt: z.string(),
  periodType: z.string(),
});
export type UsageStatus = z.infer<typeof UsageStatusSchema>;
const UsageListSchema = z.object({ usage: z.array(UsageStatusSchema) });

/** Result of the /notify push send. */
const SendResultSchema = z.object({
  sent: z.number(),
  invalidTokens: z.array(z.string()),
});
export type SendResult = z.infer<typeof SendResultSchema>;

// --- API --------------------------------------------------------------------
export const widgetApi = {
  /** List the caller's own widgets. */
  list: async (): Promise<Widget[]> => {
    const res = await apiClient.get(widgetEndpoints.list);
    const parsed = WidgetListSchema.safeParse(res.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.widgets;
  },

  /** Fetch one widget (ownership enforced server-side). */
  getById: async (id: string): Promise<Widget> => {
    const res = await apiClient.get(widgetEndpoints.byId(id));
    const parsed = WidgetEnvelopeSchema.safeParse(res.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.widget;
  },

  /** Create a widget (GATED server-side by the widget_creation quota). */
  create: async (input: CreateWidgetInput): Promise<Widget> => {
    const res = await apiClient.post(widgetEndpoints.create, input);
    const parsed = WidgetEnvelopeSchema.safeParse(res.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.widget;
  },

  /** Generate an AI description + tags (GATED by llm_generation). */
  generateDescription: async (id: string): Promise<Widget> => {
    const res = await apiClient.post(widgetEndpoints.generateDescription(id));
    const parsed = WidgetEnvelopeSchema.safeParse(res.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.widget;
  },

  /** Trigger a "widget ready" push to the caller's own devices. */
  notify: async (id: string): Promise<SendResult> => {
    const res = await apiClient.post(widgetEndpoints.notify(id));
    const parsed = SendResultSchema.safeParse(res.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },

  /** Delete a widget. */
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(widgetEndpoints.byId(id));
  },

  /** The widget_creation quota counter (for the debug cockpit's quota display). */
  getWidgetUsage: async (): Promise<UsageStatus | null> => {
    const res = await apiClient.get(widgetEndpoints.usage);
    const parsed = UsageListSchema.safeParse(res.data.data);
    if (!parsed.success) throw parsed.error;
    return (
      parsed.data.usage.find(item => item.feature === 'widget_creation') ?? null
    );
  },
};
