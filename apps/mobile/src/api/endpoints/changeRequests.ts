/**
 * @module api/endpoints/changeRequests
 *
 * Shift change requests (flows 1d/1e): cancel, time_change, counter_offer,
 * plus parent-proposed extra shifts.
 */
import { ClashWarningSchema } from '@steadily-nanny/shared-types/schemas/me.schema';
import {
  type CreateShiftChangeRequestInput,
  CreateShiftChangeRequestSchema,
  type RespondToShiftChangeRequestInput,
  RespondToShiftChangeRequestSchema,
  type ShiftChangeRequest,
  ShiftChangeRequestListResponseSchema,
  ShiftChangeRequestSchema,
  ShiftSchema,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const changeRequestEndpoints = {
  listForShift: (shiftId: string) => `/v1/shifts/${shiftId}/change-requests`,
  create: (shiftId: string) => `/v1/shifts/${shiftId}/change-requests`,
  respond: (changeRequestId: string) =>
    `/v1/change-requests/${changeRequestId}/respond`,
  withdraw: (changeRequestId: string) =>
    `/v1/change-requests/${changeRequestId}/withdraw`,
  createExtra: (householdId: string) =>
    `/v1/households/${householdId}/shifts/extra`,
} as const;

const PendingApprovalResultSchema = z.object({
  status: z.literal('pending_approval'),
  approval: z.record(z.string(), z.unknown()),
});

const CreateResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    shift_change_request: ShiftChangeRequestSchema,
  }),
  PendingApprovalResultSchema,
]);

const CreateExtraResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('created'),
    shift: ShiftSchema,
    warnings: z.array(ClashWarningSchema).default([]),
  }),
  PendingApprovalResultSchema,
]);
export type CreateExtraShiftResult = z.infer<typeof CreateExtraResultSchema>;

const CreateExtraBodySchema = z
  .object({
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    timezone: z.string().min(1),
    carer_id: z.uuid().optional(),
    child_ids: z.array(z.uuid()).optional(),
    note: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine(data => data.ends_at > data.starts_at, {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  });
export type CreateExtraShiftInput = z.infer<typeof CreateExtraBodySchema>;

export const changeRequestApi = {
  listForShift: async (shiftId: string): Promise<ShiftChangeRequest[]> => {
    const response = await apiClient.get(
      changeRequestEndpoints.listForShift(shiftId)
    );
    const parsed = ShiftChangeRequestListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.shift_change_requests;
  },

  create: async (
    shiftId: string,
    input: CreateShiftChangeRequestInput
  ): Promise<z.infer<typeof CreateResultSchema>> => {
    const validated = CreateShiftChangeRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;
    const response = await apiClient.post(
      changeRequestEndpoints.create(shiftId),
      validated.data
    );
    const parsed = CreateResultSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },

  respond: async (
    changeRequestId: string,
    input: RespondToShiftChangeRequestInput
  ): Promise<ShiftChangeRequest> => {
    const validated = RespondToShiftChangeRequestSchema.safeParse(input);
    if (!validated.success) throw validated.error;
    const response = await apiClient.post(
      changeRequestEndpoints.respond(changeRequestId),
      validated.data
    );
    const parsed = z
      .object({ shift_change_request: ShiftChangeRequestSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.shift_change_request;
  },

  createExtra: async (
    householdId: string,
    input: CreateExtraShiftInput
  ): Promise<CreateExtraShiftResult> => {
    const validated = CreateExtraBodySchema.safeParse(input);
    if (!validated.success) throw validated.error;
    const response = await apiClient.post(
      changeRequestEndpoints.createExtra(householdId),
      validated.data
    );
    const parsed = CreateExtraResultSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },
};
