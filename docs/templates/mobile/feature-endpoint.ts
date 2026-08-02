/**
 * Mobile endpoint module skeleton — the API client wrapper for `<feature>`.
 * Lives at: apps/mobile/src/api/endpoints/<feature>.ts
 *
 * Responsibilities: build the request via the shared `apiClient` (which injects the
 * Supabase JWT and handles 401 refresh), then VALIDATE the response with the shared
 * Zod schema so a contract drift surfaces here, not three screens deep.
 *
 * RULE: never import this module from a component. Components consume the query/
 * mutation hooks (see feature-query-hook.ts), which wrap these calls.
 */

import {
  type CreateWidgetInput,
  type Widget,
  WidgetListResponseSchema,
  WidgetSchema,
} from '@steadily-nanny/shared-types/schemas/widget.schema';
import { apiClient } from '../client';

export const widgetApi = {
  list: async (): Promise<Widget[]> => {
    const res = await apiClient.get('/v1/widgets');
    // API envelope is { success, message, data }. Validate the payload we rely on.
    return WidgetListResponseSchema.parse(res.data.data).widgets;
  },

  getById: async (widgetId: string): Promise<Widget> => {
    const res = await apiClient.get(`/v1/widgets/${widgetId}`);
    return WidgetSchema.parse(res.data.data.widget);
  },

  create: async (input: CreateWidgetInput): Promise<Widget> => {
    const res = await apiClient.post('/v1/widgets', input);
    return WidgetSchema.parse(res.data.data.widget);
  },
};
