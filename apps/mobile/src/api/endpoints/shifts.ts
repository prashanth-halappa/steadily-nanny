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
  events: (householdId: string, shiftId: string) =>
    `/v1/households/${householdId}/shifts/${shiftId}/events`,
  dayThread: (householdId: string, localDate: string) =>
    `/v1/households/${householdId}/day-thread?local_date=${encodeURIComponent(localDate)}`,
} as const;

const ParentEditShiftSchema = z
  .object({
    starts_at: z.iso.datetime({ offset: true }).optional(),
    ends_at: z.iso.datetime({ offset: true }).optional(),
    note: z.string().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  });
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
