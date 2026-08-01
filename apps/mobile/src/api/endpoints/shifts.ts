/**
 * @module api/endpoints/shifts
 *
 * Read-only endpoint for materialised shift instances. The wire shape comes
 * from `@steadily-nanny/shared-types/schemas/shift.schema` — never redefined
 * here.
 *
 * `from`/`to` must be full ISO datetime strings WITH an offset (e.g.
 * `"2026-08-03T00:00:00.000Z"`), never a plain "YYYY-MM-DD" calendar date —
 * `GET /v1/households/:householdId/shifts` validates them with
 * `z.iso.datetime({ offset: true })`
 * (`apps/api/src/domains/shift/schemas.ts`'s `ShiftRangeQuerySchema`) and
 * returns 400 otherwise. See `ScheduleShiftsScreen`'s `currentWeekRange` for
 * how a local calendar week gets converted to this shape.
 */
import {
  type Shift,
  ShiftListResponseSchema,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { apiClient } from '@/src/api/client';

export const shiftEndpoints = {
  range: (householdId: string, from: string, to: string) =>
    `/v1/households/${householdId}/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
} as const;

export const shiftApi = {
  /** Materialised shifts for a household in a `[from, to)` ISO-datetime range. */
  range: async (
    householdId: string,
    from: string,
    to: string
  ): Promise<Shift[]> => {
    const response = await apiClient.get(
      shiftEndpoints.range(householdId, from, to)
    );
    const parsed = ShiftListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.shifts;
  },
};
