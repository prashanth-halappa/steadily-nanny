/**
 * @module api/endpoints/commitments
 *
 * Per-child fixed commitments (preschool, school, activities). Wire shapes from
 * `@steadily-nanny/shared-types/schemas/child.schema`.
 */
import {
  type ChildCommitment,
  ChildCommitmentListResponseSchema,
  ChildCommitmentSchema,
  type CreateChildCommitmentInput,
  CreateChildCommitmentSchema,
  type UpdateChildCommitmentInput,
  UpdateChildCommitmentSchema,
} from '@steadily-nanny/shared-types/schemas/child.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export const commitmentEndpoints = {
  list: (householdId: string, childId: string) =>
    `/v1/households/${householdId}/children/${childId}/commitments`,
  create: (householdId: string, childId: string) =>
    `/v1/households/${householdId}/children/${childId}/commitments`,
  update: (commitmentId: string) => `/v1/commitments/${commitmentId}`,
  remove: (commitmentId: string) => `/v1/commitments/${commitmentId}`,
} as const;

const CommitmentEnvelopeSchema = z.object({
  child_commitment: ChildCommitmentSchema,
});

export const commitmentApi = {
  list: async (
    householdId: string,
    childId: string
  ): Promise<ChildCommitment[]> => {
    const response = await apiClient.get(
      commitmentEndpoints.list(householdId, childId)
    );
    const parsed = ChildCommitmentListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.child_commitments;
  },

  create: async (
    householdId: string,
    childId: string,
    input: CreateChildCommitmentInput
  ): Promise<ChildCommitment> => {
    const validated = CreateChildCommitmentSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      commitmentEndpoints.create(householdId, childId),
      validated.data
    );
    const parsed = CommitmentEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.child_commitment;
  },

  update: async (
    commitmentId: string,
    input: UpdateChildCommitmentInput
  ): Promise<ChildCommitment> => {
    const validated = UpdateChildCommitmentSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      commitmentEndpoints.update(commitmentId),
      validated.data
    );
    const parsed = CommitmentEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.child_commitment;
  },

  remove: async (commitmentId: string): Promise<void> => {
    await apiClient.delete(commitmentEndpoints.remove(commitmentId));
  },
};
