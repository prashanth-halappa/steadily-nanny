/**
 * @module api/endpoints/handoff
 *
 * Daily handoff notes (design flow 1i). Wire shapes from
 * `@steadily-nanny/shared-types/schemas/handoff.schema`.
 */
import {
  type CreateHandoffNoteInput,
  CreateHandoffNoteSchema,
  type HandoffNote,
  HandoffNoteListResponseSchema,
  HandoffNoteSchema,
  type HandoffRecap,
  HandoffRecapSchema,
  type UpdateHandoffNoteInput,
  UpdateHandoffNoteSchema,
} from '@steadily-nanny/shared-types/schemas/handoff.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const handoffEndpoints = {
  list: (householdId: string, localDate: string) =>
    `/v1/households/${householdId}/handoff-notes?local_date=${encodeURIComponent(localDate)}`,
  create: (householdId: string) =>
    `/v1/households/${householdId}/handoff-notes`,
  update: (handoffNoteId: string) => `/v1/handoff-notes/${handoffNoteId}`,
  recap: (householdId: string, localDate: string) =>
    `/v1/households/${householdId}/handoff-notes/recap?local_date=${encodeURIComponent(localDate)}`,
} as const;

const HandoffNoteEnvelopeSchema = z.object({
  handoff_note: HandoffNoteSchema,
});

const HandoffRecapEnvelopeSchema = z.object({ recap: HandoffRecapSchema });

export const handoffApi = {
  list: async (
    householdId: string,
    localDate: string
  ): Promise<HandoffNote[]> => {
    const response = await apiClient.get(
      handoffEndpoints.list(householdId, localDate)
    );
    const parsed = HandoffNoteListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.handoff_notes;
  },

  create: async (
    householdId: string,
    input: CreateHandoffNoteInput
  ): Promise<HandoffNote> => {
    const validated = CreateHandoffNoteSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      handoffEndpoints.create(householdId),
      validated.data
    );
    const parsed = HandoffNoteEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.handoff_note;
  },

  update: async (
    handoffNoteId: string,
    input: UpdateHandoffNoteInput
  ): Promise<HandoffNote> => {
    const validated = UpdateHandoffNoteSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      handoffEndpoints.update(handoffNoteId),
      validated.data
    );
    const parsed = HandoffNoteEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.handoff_note;
  },

  recap: async (
    householdId: string,
    localDate: string
  ): Promise<HandoffRecap> => {
    const response = await apiClient.get(
      handoffEndpoints.recap(householdId, localDate)
    );
    const parsed = HandoffRecapEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.recap;
  },
};
