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
  ReopenTimesheetInput,
  Timesheet,
  TimesheetWeek,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  QueryTimesheetSchema,
  ReopenTimesheetSchema,
  TimesheetListResponseSchema,
  TimesheetSchema,
  TimesheetWeekSchema,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export type {
  EarningsLine,
  EarningsLineKind,
  HoursOnlyReason,
  TimesheetStatus,
  WeekEarnings,
  WeekEarningsOk,
  WeekEarningsStateResult,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
export {
  EARNINGS_LINE_KINDS,
  EARNINGS_LINE_ORDER,
  EARNINGS_RESULT_STATUSES,
  HOURS_ONLY_REASONS,
  TIMESHEET_STATUSES,
  WEEK_EARNINGS_STATES,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
// Re-exported so domain-internal imports (`@/src/api/endpoints/timesheets`)
// stay stable regardless of where the wire contract itself lives.
export type {
  QueryTimesheetInput,
  ReopenTimesheetInput,
  Timesheet,
  TimesheetWeek,
};

// --- Endpoint URLs ----------------------------------------------------------
export const timesheetEndpoints = {
  listForHousehold: (householdId: string) =>
    `/v1/households/${householdId}/timesheets`,
  getWeek: (timesheetId: string) => `/v1/timesheets/${timesheetId}`,
  approve: (timesheetId: string) => `/v1/timesheets/${timesheetId}/approve`,
  query: (timesheetId: string) => `/v1/timesheets/${timesheetId}/query`,
  reopen: (timesheetId: string) => `/v1/timesheets/${timesheetId}/reopen`,
  exportCsv: (timesheetId: string) =>
    `/v1/timesheets/${timesheetId}/export.csv`,
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
   * EVERY carer's timesheet for one household week, each WITH its earnings
   * attached — empty when no row exists yet (no row is created until the
   * first clock-out of that week — `timesheetCommandService.clockOut`).
   * Filters the full list client-side by week; see `list`'s doc comment for
   * why there's no server-side week param here. The earnings themselves come
   * from a call to `getById` per row — `GET /timesheets/:id` is where the
   * server decides live-vs-frozen (`timesheetQueryService.getWeekWithEarnings`),
   * and that decision must never be made twice or made here.
   *
   * Returns a LIST, not one row (F-B1-3): a timesheet is identified by
   * `(household_id, carer_id, week_start)`, never by the week alone, and the
   * server orders by `week_start` only — so `find(t => t.week_start === …)`
   * in a two-carer household binds to whichever carer sorted first. Callers
   * pick their own carer's row. This also keeps the React Query cache
   * honest: `queryKeys.timesheet.week(householdId, weekStart)` names a
   * household week, and that is now exactly what the entry holds — no carer
   * can be served another's cached row.
   *
   * ponytail: one `getById` per carer row (1–2 in practice). Add a
   * server-side `?week_start=` + embedded earnings if a household ever has
   * enough carers for the fan-out to matter.
   */
  getWeek: async (
    householdId: string,
    weekStart: string
  ): Promise<TimesheetWeek[]> => {
    const timesheets = await timesheetApi.list(householdId);
    const matches = timesheets.filter(t => t.week_start === weekStart);
    return Promise.all(matches.map(t => timesheetApi.getById(t.id)));
  },

  /**
   * `GET /timesheets/:id` — one week with its earnings attached, live or
   * frozen (`docs/11-MONEY.md` §3). Any active household member may call
   * this (a nanny must be able to see what she is owed); only a parent may
   * approve/query.
   */
  getById: async (timesheetId: string): Promise<TimesheetWeek> => {
    const response = await apiClient.get(
      timesheetEndpoints.getWeek(timesheetId)
    );
    const parsed = z
      .object({ timesheet: TimesheetWeekSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.timesheet;
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

  /**
   * Reopen an approved week — the undo for approve. Parents only; requires a
   * recorded reason. Returns the week to `submitted` and clears the frozen
   * earnings snapshot so the figure can change again.
   */
  reopen: async (
    timesheetId: string,
    input: ReopenTimesheetInput
  ): Promise<Timesheet> => {
    const validated = ReopenTimesheetSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      timesheetEndpoints.reopen(timesheetId),
      validated.data
    );
    const parsed = z
      .object({ timesheet: TimesheetSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.timesheet;
  },

  /**
   * `GET /timesheets/:id/export.csv` — the week as a CSV attachment,
   * APPROVED weeks only (the server 409s otherwise). The ONE endpoint in
   * this module that is not JSON: it returns `text/csv`, so there is no
   * success envelope to unwrap and no Zod schema to validate against.
   *
   * `responseType: 'text'` is load-bearing. Axios's default JSON transform
   * would try to parse the body and — worse than throwing — quietly hand
   * back a string that has been round-tripped through a parse attempt. The
   * explicit `Accept` header keeps a future content-negotiating server from
   * answering this route with JSON.
   *
   * Returned VERBATIM. The server owns the column order and the summary
   * rows; re-deriving or reformatting any of it here would be a second
   * implementation of the same money figures (docs/11-MONEY.md §1).
   */
  exportCsv: async (timesheetId: string): Promise<string> => {
    const response = await apiClient.get(
      timesheetEndpoints.exportCsv(timesheetId),
      { responseType: 'text', headers: { Accept: 'text/csv' } }
    );
    return response.data as string;
  },
};
