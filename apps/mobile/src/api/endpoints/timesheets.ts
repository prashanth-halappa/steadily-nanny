// File: src/api/endpoints/timesheets.ts
// Description: API endpoints and Zod response validation for the weekly
// timesheet roll-up (approve / query). Wire shapes come from the ONE shared
// source — `@steadily-nanny/shared-types/schemas/timesheet.schema` — never
// redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import type {
  QueryTimesheetInput,
  Timesheet,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  QueryTimesheetSchema,
  TimesheetListResponseSchema,
  TimesheetSchema,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export type { TimesheetStatus } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
export { TIMESHEET_STATUSES } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
// Re-exported so domain-internal imports (`@/src/api/endpoints/timesheets`)
// stay stable regardless of where the wire contract itself lives.
export type { QueryTimesheetInput, Timesheet };

// --- Endpoint URLs ----------------------------------------------------------
export const timesheetEndpoints = {
  listForHousehold: (householdId: string) =>
    `/v1/households/${householdId}/timesheets`,
  approve: (timesheetId: string) => `/v1/timesheets/${timesheetId}/approve`,
  query: (timesheetId: string) => `/v1/timesheets/${timesheetId}/query`,
} as const;

// --- API --------------------------------------------------------------------
export const timesheetApi = {
  /**
   * All of a household's timesheets (every carer, every week on record) —
   * `GET /households/:householdId/timesheets` has no server-side week
   * filter (see `apps/api/src/domains/timesheet/routes/householdTimesheetRoutes.ts`),
   * unlike the time-entries list, so `getWeek` below filters client-side.
   */
  list: async (householdId: string): Promise<Timesheet[]> => {
    const response = await apiClient.get(
      timesheetEndpoints.listForHousehold(householdId)
    );
    const parsed = TimesheetListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.timesheets;
  },

  /**
   * One week's timesheet for a household, or null if none exists yet (no
   * row is created until the first clock-out of that week —
   * `timesheetCommandService.clockOut`). Filters the full list client-side;
   * see `list`'s doc comment for why there's no server-side week param here.
   */
  getWeek: async (
    householdId: string,
    weekStart: string
  ): Promise<Timesheet | null> => {
    const timesheets = await timesheetApi.list(householdId);
    return timesheets.find(t => t.week_start === weekStart) ?? null;
  },

  /** Approve a week in one tap. Parents only — enforced server-side. */
  approve: async (timesheetId: string): Promise<Timesheet> => {
    const response = await apiClient.post(
      timesheetEndpoints.approve(timesheetId)
    );
    const parsed = z
      .object({ timesheet: TimesheetSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.timesheet;
  },

  /** Query a week with a note — the approval escape hatch. Parents only. */
  query: async (
    timesheetId: string,
    input: QueryTimesheetInput
  ): Promise<Timesheet> => {
    const validated = QueryTimesheetSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      timesheetEndpoints.query(timesheetId),
      validated.data
    );
    const parsed = z
      .object({ timesheet: TimesheetSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.timesheet;
  },
};
