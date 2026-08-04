// File: src/api/endpoints/householdClosures.ts
// Description: API endpoints and Zod response validation for
// parent-declared household closures ("we're away, no cover needed"). Wire
// shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/availability.schema` — never
// redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.
//
// DISTINCT FROM `carer_time_off` (`src/api/endpoints/timeOff.ts`): a closure
// is scoped to ONE household, not the caller — every route is nested under
// `/v1/households/:householdId/closures`. Read is member-visible; write
// (create/update/delete) is owner/parent-gated server-side (403 for anyone
// else — see `householdClosureCommandService.assertWriteRole`).
//
// HARD DELETE: `DELETE /v1/households/:householdId/closures/:closureId`
// removes the row — unlike time off's soft-cancel, there is no 'cancelled'
// status to keep around, and the API response body is empty on success.

import type {
  CreateHouseholdClosureInput,
  HouseholdClosure,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import {
  CreateHouseholdClosureSchema,
  HouseholdClosureListResponseSchema,
  HouseholdClosureSchema,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export type { CreateHouseholdClosureInput, HouseholdClosure };

// --- Endpoint URLs ----------------------------------------------------------
export const householdClosureEndpoints = {
  list: (householdId: string) => `/v1/households/${householdId}/closures`,
  create: (householdId: string) => `/v1/households/${householdId}/closures`,
  byId: (householdId: string, closureId: string) =>
    `/v1/households/${householdId}/closures/${closureId}`,
} as const;

// --- API --------------------------------------------------------------------
export const householdClosureApi = {
  /** All closures for a household, earliest first — any active member may read. */
  list: async (householdId: string): Promise<HouseholdClosure[]> => {
    const response = await apiClient.get(
      householdClosureEndpoints.list(householdId)
    );
    const parsed = HouseholdClosureListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.household_closures;
  },

  /** Declare a closure — owner/parent only (403 for anyone else). */
  create: async (
    householdId: string,
    input: CreateHouseholdClosureInput
  ): Promise<HouseholdClosure> => {
    const validated = CreateHouseholdClosureSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      householdClosureEndpoints.create(householdId),
      validated.data
    );
    // API-CONTRACT: POST response is singular — { household_closure: <one row> }.
    const parsed = z
      .object({ household_closure: HouseholdClosureSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.household_closure;
  },

  /** Hard-delete a closure — owner/parent only. */
  remove: async (householdId: string, closureId: string): Promise<void> => {
    await apiClient.delete(
      householdClosureEndpoints.byId(householdId, closureId)
    );
  },
};
