// File: src/api/endpoints/timeOff.ts
// Description: API endpoints and Zod response validation for a carer's own
// time-off requests. Wire shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/availability.schema` — never
// redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.
//
// AUTO-APPROVED, NO APPROVAL STEP: `POST /v1/time-off` creates a row with
// status 'confirmed' by construction — the create schema has no `status`
// field at all, and the DB column defaults to 'confirmed'. There is no
// approval endpoint anywhere in the API; a parent never approves a request.
// `DELETE /v1/time-off/:id` is a SOFT cancel (status -> 'cancelled'), never
// a hard delete — the row and its history persist, hence it still returns
// the updated row, not an empty 204.
//
// NO SERVER-SIDE SHIFT-CONFLICT CHECK: creating time off that overlaps a
// confirmed shift is allowed unconditionally — nothing on the server blocks,
// warns, or auto-cancels the shift. Do not imply otherwise in the UI.
//
// GET /v1/time-off takes no query params — the server filters to the
// caller's own rows via auth (`WHERE user_id = <caller>`), not a household
// or date-range argument, because time off is scoped to the carer, not any
// one household.
//
// GET /v1/households/:id/time-off is the parent-facing list — carers who are
// active members of THAT household only.

import type {
  CarerTimeOff,
  CreateCarerTimeOffInput,
  UpdateCarerTimeOffInput,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import {
  CarerTimeOffListResponseSchema,
  CarerTimeOffSchema,
  CreateCarerTimeOffSchema,
  UpdateCarerTimeOffSchema,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export { CARER_TIME_OFF_STATUSES } from '@steadily-nanny/shared-types/schemas/availability.schema';
export type { CarerTimeOff, CreateCarerTimeOffInput, UpdateCarerTimeOffInput };

// --- Endpoint URLs ----------------------------------------------------------
export const timeOffEndpoints = {
  list: '/v1/time-off',
  create: '/v1/time-off',
  byId: (timeOffId: string) => `/v1/time-off/${timeOffId}`,
  forHousehold: (householdId: string) =>
    `/v1/households/${householdId}/time-off`,
} as const;

// --- API --------------------------------------------------------------------
export const timeOffApi = {
  /** The caller's own time-off rows — requested, confirmed, and cancelled alike. */
  list: async (): Promise<CarerTimeOff[]> => {
    const response = await apiClient.get(timeOffEndpoints.list);
    const parsed = CarerTimeOffListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_time_off;
  },

  /** Carers' time off for one household — caller must be an active member. */
  listForHousehold: async (householdId: string): Promise<CarerTimeOff[]> => {
    const response = await apiClient.get(
      timeOffEndpoints.forHousehold(householdId)
    );
    const parsed = CarerTimeOffListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_time_off;
  },

  /** Create a time-off request — instantly 'confirmed', see the module header. */
  create: async (input: CreateCarerTimeOffInput): Promise<CarerTimeOff> => {
    const validated = CreateCarerTimeOffSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      timeOffEndpoints.create,
      validated.data
    );
    // API-CONTRACT: POST response is singular — { carer_time_off: <one row> },
    // NOT the list envelope GET / returns.
    const parsed = z
      .object({ carer_time_off: CarerTimeOffSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_time_off;
  },

  /** Soft-cancel a time-off row the caller owns — never a hard delete. */
  cancel: async (timeOffId: string): Promise<CarerTimeOff> => {
    const response = await apiClient.delete(timeOffEndpoints.byId(timeOffId));
    const parsed = z
      .object({ carer_time_off: CarerTimeOffSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_time_off;
  },

  /** Edit dates/message on a time-off row the caller owns — cancel stays on DELETE. */
  update: async (
    timeOffId: string,
    input: UpdateCarerTimeOffInput
  ): Promise<CarerTimeOff> => {
    if (input.status !== undefined) {
      const error = Object.assign(new Error('Use DELETE to cancel time off'), {
        code: 'CANCEL_VIA_DELETE',
      });
      throw error;
    }

    const validated = UpdateCarerTimeOffSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      timeOffEndpoints.byId(timeOffId),
      validated.data
    );
    const parsed = z
      .object({ carer_time_off: CarerTimeOffSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.carer_time_off;
  },
};
