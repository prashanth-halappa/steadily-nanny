// File: src/api/endpoints/children.ts
// Description: API endpoints, Zod response validation, and types for a
// household's children. Wire shapes come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/child.schema` — never redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope at `response.data.data` before validating with Zod.

import {
  type Child,
  ChildListResponseSchema,
  ChildSchema,
  type CreateChildInput,
  CreateChildSchema,
  type UpdateChildInput,
  UpdateChildSchema,
} from '@steadily-nanny/shared-types/schemas/child.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// --- Endpoint URLs ----------------------------------------------------------
export const childrenEndpoints = {
  list: (householdId: string) => `/v1/households/${householdId}/children`,
  create: (householdId: string) => `/v1/households/${householdId}/children`,
  item: (householdId: string, childId: string) =>
    `/v1/households/${householdId}/children/${childId}`,
} as const;

// --- API --------------------------------------------------------------------
export const childrenApi = {
  /** All (non-archived) children in a household. */
  list: async (householdId: string): Promise<Child[]> => {
    const response = await apiClient.get(childrenEndpoints.list(householdId));
    const parsed = ChildListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.children;
  },

  /** Add a child to a household. */
  create: async (
    householdId: string,
    input: CreateChildInput
  ): Promise<Child> => {
    const validated = CreateChildSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      childrenEndpoints.create(householdId),
      validated.data
    );
    const parsed = z
      .object({ child: ChildSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.child;
  },

  /** Update a child's fields. */
  update: async (
    householdId: string,
    childId: string,
    input: UpdateChildInput
  ): Promise<Child> => {
    const validated = UpdateChildSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      childrenEndpoints.item(householdId, childId),
      validated.data
    );
    const parsed = z
      .object({ child: ChildSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.child;
  },

  /** Soft-delete (archive) a child — never a hard delete server-side. */
  remove: async (householdId: string, childId: string): Promise<Child> => {
    const response = await apiClient.delete(
      childrenEndpoints.item(householdId, childId)
    );
    const parsed = z
      .object({ child: ChildSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.child;
  },
};
