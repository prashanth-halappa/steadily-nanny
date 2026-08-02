// File: src/api/endpoints/availability.ts
// Description: API endpoints, Zod response validation, and types for the
// signed-in nanny's own weekly availability. Wire shapes come from the ONE
// shared source — `@steadily-nanny/shared-types/schemas/availability.schema`
// — never redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope at `response.data.data` before validating with
// Zod. `PUT /v1/availability/me` upserts exactly ONE weekday row, keyed on
// `(user_id, weekday)` server-side — see the shared schema's doc comment:
// "this shape is both the create and the full-replace body." Callers should
// send every field they want kept, not just the one that changed.

import type {
  CarerAvailability,
  CreateCarerAvailabilityInput,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import {
  CarerAvailabilityListResponseSchema,
  CarerAvailabilitySchema,
  CreateCarerAvailabilitySchema,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// --- Endpoint URLs ----------------------------------------------------------
export const availabilityEndpoints = {
  getMine: '/v1/availability/me',
  upsertMine: '/v1/availability/me',
  getForUser: (userId: string) => `/v1/availability/${userId}`,
} as const;

// --- API --------------------------------------------------------------------
export const availabilityApi = {
  /** The caller's own weekday availability rows (0..7 entries, one per weekday). */
  getMine: async (): Promise<CarerAvailability[]> => {
    const response = await apiClient.get(availabilityEndpoints.getMine);
    const parsed = CarerAvailabilityListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_availability;
  },

  /**
   * Another user's weekday availability rows — for a parent checking a
   * carer's stated hours while building or reviewing a schedule with them.
   * Server-gated on an active shared household (404 either way if none —
   * see `availabilityRoutes.ts`'s ownership check, "not shared" and
   * "doesn't exist" are indistinguishable by design).
   */
  getForUser: async (userId: string): Promise<CarerAvailability[]> => {
    const response = await apiClient.get(
      availabilityEndpoints.getForUser(userId)
    );
    const parsed = CarerAvailabilityListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_availability;
  },

  /** Upsert one weekday row. Send the full row, not a partial diff. */
  upsertWeekday: async (
    input: CreateCarerAvailabilityInput
  ): Promise<CarerAvailability> => {
    const validated = CreateCarerAvailabilitySchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.put(
      availabilityEndpoints.upsertMine,
      validated.data
    );
    // API-CONTRACT: PUT response is singular — { carer_availability: <one row> },
    // NOT the list envelope GET /me returns.
    const parsed = z
      .object({ carer_availability: CarerAvailabilitySchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_availability;
  },
};
