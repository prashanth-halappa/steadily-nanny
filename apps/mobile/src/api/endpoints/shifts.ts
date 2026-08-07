/**
 * @module api/endpoints/shifts
 *
 * Materialised shift instances + parent edit + day thread. Wire shapes from
 * `@steadily-nanny/shared-types/schemas/shift.schema`.
 *
 * `from`/`to` must be full ISO datetime strings WITH an offset — see
 * `ShiftRangeQuerySchema`. Parent edit body is the narrow ParentEditShift
 * shape (starts_at / ends_at / note only).
 */
import {
  type ClashWarning,
  ClashWarningSchema,
} from '@steadily-nanny/shared-types/schemas/me.schema';
import {
  type Shift,
  type ShiftEvent,
  ShiftEventListResponseSchema,
  ShiftListResponseSchema,
  ShiftSchema,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const shiftEndpoints = {
  range: (householdId: string, from: string, to: string) =>
    `/v1/households/${householdId}/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  getById: (shiftId: string) => `/v1/shifts/${shiftId}`,
  update: (shiftId: string) => `/v1/shifts/${shiftId}`,
  accept: (shiftId: string) => `/v1/shifts/${shiftId}/accept`,
  decline: (shiftId: string) => `/v1/shifts/${shiftId}/decline`,
  events: (householdId: string, shiftId: string) =>
    `/v1/households/${householdId}/shifts/${shiftId}/events`,
  dayThread: (householdId: string, localDate: string) =>
    `/v1/households/${householdId}/day-thread?local_date=${encodeURIComponent(localDate)}`,
} as const;

/**
 * API TWIN: `apps/api/src/domains/shift/schemas.ts`'s `ParentEditShiftSchema`.
 * Hand-copied rather than imported because that schema is server-only (URL and
 * narrow-body validation lives in the API domain, not in `shared-types`, which
 * is kept to wire shapes) — so the two must be kept in step by hand, and this
 * copy had already drifted: it never grew the ordering refine, which meant an
 * inverted edit was posted to the server just to be rejected on the round trip.
 */
const ParentEditShiftSchema = z
  .object({
    starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }).optional(),
    note: z.string().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  })
  .refine(
    // Instant compare — lexicographic ISO strings break across offsets
    // (e.g. `…T11:00:00-01:00` vs `…T12:00:00+00:00`).
    data =>
      data.starts_at === undefined ||
      data.ends_at === undefined ||
      Date.parse(data.ends_at) > Date.parse(data.starts_at),
    { message: 'ends_at must be after starts_at', path: ['ends_at'] }
  );
export type ParentEditShiftInput = z.infer<typeof ParentEditShiftSchema>;

const ShiftEnvelopeSchema = z.object({ shift: ShiftSchema });

/** Write responses may attach non-blocking clash warnings alongside the shift. */
const ShiftWriteEnvelopeSchema = z.object({
  shift: ShiftSchema,
  warnings: z.array(ClashWarningSchema).default([]),
});
export type ShiftWriteResult = {
  shift: Shift;
  warnings: ClashWarning[];
};

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

  getById: async (shiftId: string): Promise<Shift> => {
    const response = await apiClient.get(shiftEndpoints.getById(shiftId));
    const parsed = ShiftEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.shift;
  },

  update: async (
    shiftId: string,
    input: ParentEditShiftInput
  ): Promise<ShiftWriteResult> => {
    const validated = ParentEditShiftSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      shiftEndpoints.update(shiftId),
      validated.data
    );
    const parsed = ShiftWriteEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },

  /** Carer-only: pending → confirmed. Body-less POST. */
  accept: async (shiftId: string): Promise<ShiftWriteResult> => {
    const response = await apiClient.post(shiftEndpoints.accept(shiftId));
    const parsed = ShiftWriteEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },

  /**
   * Carer-only: pending → declined. Body-less POST. No clash-warnings arm —
   * a declined shift is off the calendar, so `ShiftEnvelopeSchema` (not the
   * write-with-warnings envelope `accept` uses) is the right shape here.
   */
  decline: async (shiftId: string): Promise<Shift> => {
    const response = await apiClient.post(shiftEndpoints.decline(shiftId));
    const parsed = ShiftEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.shift;
  },

  listEvents: async (
    householdId: string,
    shiftId: string
  ): Promise<ShiftEvent[]> => {
    const response = await apiClient.get(
      shiftEndpoints.events(householdId, shiftId)
    );
    const parsed = ShiftEventListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.shift_events;
  },

  listDayThread: async (
    householdId: string,
    localDate: string
  ): Promise<ShiftEvent[]> => {
    const response = await apiClient.get(
      shiftEndpoints.dayThread(householdId, localDate)
    );
    const parsed = ShiftEventListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.shift_events;
  },
};
