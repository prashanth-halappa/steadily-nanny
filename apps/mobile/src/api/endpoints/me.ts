/**
 * @module api/endpoints/me
 *
 * Cross-household "me" reads — a carer's own shifts across every household
 * they belong to, plus pending change requests awaiting their response.
 * Wire shapes from shared-types me/shift schemas.
 */
import {
  type MeShift,
  MeShiftListResponseSchema,
} from '@steadily-nanny/shared-types/schemas/me.schema';
import {
  type ShiftChangeRequest,
  ShiftChangeRequestListResponseSchema,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { apiClient } from '@/src/api/client';

export const meEndpoints = {
  shifts: (from: string, to: string) =>
    `/v1/me/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  changeRequests: (from: string, to: string) =>
    `/v1/me/change-requests?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
} as const;

export const meApi = {
  /** Caller's own shifts (carer_id === me) across all active households. */
  listShifts: async (from: string, to: string): Promise<MeShift[]> => {
    const response = await apiClient.get(meEndpoints.shifts(from, to));
    const parsed = MeShiftListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.shifts;
  },

  /**
   * Pending change requests awaiting the caller's response across every
   * active household membership (inbox fan-in — replaces per-shift N+1).
   */
  listPendingChangeRequests: async (
    from: string,
    to: string
  ): Promise<ShiftChangeRequest[]> => {
    const response = await apiClient.get(meEndpoints.changeRequests(from, to));
    const parsed = ShiftChangeRequestListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.shift_change_requests;
  },
};
