// File: src/api/endpoints/timeEntries.ts
// Description: API endpoints and Zod response validation for clock in/out.
// Wire shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/timesheet.schema` — never redefined
// here (it landed from the concurrent apps/api/src/domains/timesheet build;
// this file used to carry a local mirror pending that — see git history if
// you need the old comment).
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import type {
  ClockInInput,
  ClockOutInput,
  TimeEntry,
  UpdateTimeEntryInput,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  ClockInSchema,
  ClockOutSchema,
  TimeEntryListResponseSchema,
  TimeEntrySchema,
  UpdateTimeEntrySchema,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export type {
  TimeEntryKind,
  TimeEntryStatus,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
export {
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
// Re-exported so domain-internal imports (`@/src/api/endpoints/timeEntries`)
// stay stable regardless of where the wire contract itself lives.
export type { ClockInInput, ClockOutInput, TimeEntry, UpdateTimeEntryInput };

// --- Endpoint URLs ----------------------------------------------------------
export const timeEntryEndpoints = {
  clockIn: '/v1/time-entries/clock-in',
  clockOut: (entryId: string) => `/v1/time-entries/${entryId}/clock-out`,
  update: (entryId: string) => `/v1/time-entries/${entryId}`,
  running: '/v1/time-entries/running',
  weekForHousehold: (householdId: string) =>
    `/v1/households/${householdId}/time-entries`,
} as const;

// --- API --------------------------------------------------------------------
export const timeEntryApi = {
  /**
   * Clock in. `shift_id` is optional — "starting early / covering ad hoc" is
   * a normal, unblocked path (see the today domain's clock-in card). At most
   * one RUNNING entry per carer is enforced by a DB partial unique index
   * (`time_entries_one_running_per_carer`); a duplicate clock-in comes back
   * as a 409 with error code `ALREADY_CLOCKED_IN`
   * (`apps/api/src/domains/timesheet/errors/timesheetErrors.ts`) — see
   * `useClockIn` for where that's shown plainly rather than generically.
   */
  clockIn: async (input: ClockInInput): Promise<TimeEntry> => {
    const validated = ClockInSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      timeEntryEndpoints.clockIn,
      validated.data
    );
    const parsed = z
      .object({ time_entry: TimeEntrySchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.time_entry;
  },

  /** Clock out of the caller's running entry. */
  clockOut: async (
    entryId: string,
    input: ClockOutInput = {}
  ): Promise<TimeEntry> => {
    const validated = ClockOutSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      timeEntryEndpoints.clockOut(entryId),
      validated.data
    );
    const parsed = z
      .object({ time_entry: TimeEntrySchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.time_entry;
  },

  /**
   * Correct an already-clocked-out entry (Daylight UX P0-2). Carer-only, and
   * only while the week is still unapproved — the server owns that gate and
   * answers a stale attempt with a 409 `TIME_ENTRY_NOT_EDITABLE`.
   */
  update: async (
    entryId: string,
    input: UpdateTimeEntryInput
  ): Promise<TimeEntry> => {
    const validated = UpdateTimeEntrySchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      timeEntryEndpoints.update(entryId),
      validated.data
    );
    const parsed = z
      .object({ time_entry: TimeEntrySchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.time_entry;
  },

  /** The caller's own open entry, or null if not currently clocked in. */
  getRunning: async (): Promise<TimeEntry | null> => {
    const response = await apiClient.get(timeEntryEndpoints.running);
    const parsed = z
      .object({ time_entry: TimeEntrySchema.nullable() })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.time_entry;
  },

  /**
   * A household's entries for one week (Monday `week_start`, en-GB weeks).
   * `week_start` is optional server-side (defaults to the current week) —
   * this client always sends it explicitly since callers already know which
   * week they're showing.
   */
  listForWeek: async (
    householdId: string,
    weekStart: string
  ): Promise<TimeEntry[]> => {
    const response = await apiClient.get(
      timeEntryEndpoints.weekForHousehold(householdId),
      { params: { week_start: weekStart } }
    );
    const parsed = TimeEntryListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.time_entries;
  },
};
