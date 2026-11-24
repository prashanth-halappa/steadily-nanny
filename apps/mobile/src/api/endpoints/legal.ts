// File: src/api/endpoints/legal.ts
// Description: API endpoints and Zod response validation for legal acceptance
// (Terms of Service + Privacy Policy). Wire shapes come from the ONE shared
// source — `@steadily-nanny/shared-types` — never redefined here.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import type {
  AcceptLegalRequest,
  LegalStatus,
} from '@steadily-nanny/shared-types';
import {
  AcceptLegalRequestSchema,
  LegalStatusSchema,
} from '@steadily-nanny/shared-types';
import { apiClient } from '@/src/api/client';

export type { AcceptLegalRequest, LegalStatus };

// --- Endpoint URLs ----------------------------------------------------------
export const legalEndpoints = {
  acceptance: '/v1/legal/acceptance',
} as const;

// --- API --------------------------------------------------------------------
export const legalApi = {
  /**
   * `GET /v1/legal/acceptance` — current legal version and whether the
   * signed-in user still needs to accept it.
   */
  getStatus: async (): Promise<LegalStatus> => {
    const response = await apiClient.get(legalEndpoints.acceptance);
    const parsed = LegalStatusSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },

  /**
   * `POST /v1/legal/acceptance` — record the user's explicit acceptance of the
   * current legal version. Idempotent for the current version; returns 409
   * (`CONFLICT` / `LEGAL_VERSION_MISMATCH`) on a stale version.
   */
  accept: async (body: AcceptLegalRequest): Promise<LegalStatus> => {
    const validated = AcceptLegalRequestSchema.safeParse(body);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      legalEndpoints.acceptance,
      validated.data
    );
    const parsed = LegalStatusSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },
};
