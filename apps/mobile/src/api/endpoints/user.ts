// File: src/api/endpoints/user.ts
// Description: API endpoints, Zod response validation, and types for the
// authenticated user's profile and account deletion. (Device registration lives
// in ./notifications — POST /v1/notifications/devices.)
//
// Every network call goes through the shared `apiClient` (the integrator-owned
// seam) and unwraps the standard success envelope
// `{ success, data, message, timestamp, requestId }` at `response.data.data`
// before validating the payload with Zod.

import type {
  UserDeleteAccountResponse,
  UserProfile,
  UserProfileRequest,
} from '@steadily-nanny/shared-types';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// --- Endpoint URLs ----------------------------------------------------------
export const userEndpoints = {
  // API-CONTRACT: GET returns the caller's own profile (auth resolves identity).
  getProfile: '/v1/users/me',
  // API-CONTRACT: POST create-or-update (upsert) of the caller's profile.
  upsertProfile: '/v1/users/profile',
  // API-CONTRACT: PATCH partial-updates the caller's profile. The full
  // server schema (`apps/api/src/schemas/user.schema.ts`'s
  // `UpdateProfileSchema`) also accepts `name`/`city`/`country`/`timezone`/
  // `week_starts_on` — only `preferred_locale` is wired here (D26). The
  // per-user `timezone` field is a SEPARATE, not-yet-landed feature (D29);
  // do not wire it through this method until that contract lands.
  updateProfile: '/v1/users/me',
  // API-CONTRACT: DELETE removes the caller's account and all associated data.
  deleteAccount: '/v1/users/me',
} as const;

// --- Zod schemas ------------------------------------------------------------

// API-CONTRACT: mirrors the `UserProfile` domain model. `user_id` is always
// present; the display fields may be null until the profile is completed.
const UserProfileSchema = z.object({
  user_id: z.string(),
  name: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  preferred_locale: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  additional_data: z.record(z.string(), z.unknown()).nullable().optional(),
});

// API-CONTRACT: POST /v1/users/profile returns the `UserProfileResponse` DTO
// (`{ message, user }`) inside the success envelope's `data`.
const UserProfileResponseSchema = z.object({
  message: z.string(),
  user: UserProfileSchema,
});

// API-CONTRACT: DELETE /v1/users returns the `UserDeleteAccountResponse` DTO
// (`{ success, message }`) inside the success envelope's `data`.
const UserDeleteAccountResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Outgoing profile upsert payload — validated client-side before the request.
const UserProfileRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  city: z.string().min(1, 'City is required'),
  country: z.string().min(1, 'Country is required'),
  additional_data: z.record(z.string(), z.unknown()).optional(),
});

// API-CONTRACT: PATCH /v1/users/me returns `{ user: UserProfile }` — note
// this is a DIFFERENT envelope shape than `upsertProfile`'s `{ message, user }`.
const UpdateProfileResponseSchema = z.object({ user: UserProfileSchema });

// Outgoing PATCH payload, scoped to preferred_locale only (see
// `userEndpoints.updateProfile`'s comment for why the rest of the server
// schema isn't exposed here yet). Mirrors the server's
// `preferred_locale: z.string().max(16).optional()` but required+non-empty
// from the client, since every call site always sends a real locale code.
const UpdatePreferredLocaleSchema = z.object({
  preferred_locale: z.string().min(1).max(16),
});
export type UpdatePreferredLocaleInput = z.infer<
  typeof UpdatePreferredLocaleSchema
>;

// --- API --------------------------------------------------------------------
export const userApi = {
  /**
   * Fetch the authenticated user's profile.
   */
  getProfile: async (): Promise<UserProfile> => {
    const response = await apiClient.get(userEndpoints.getProfile);
    // API-CONTRACT: unwrap the success envelope — payload lives at data.data.
    const parsed = UserProfileSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },

  /**
   * Create or update the authenticated user's profile.
   * @param req - Profile fields to persist
   */
  upsertProfile: async (req: UserProfileRequest): Promise<UserProfile> => {
    const validated = UserProfileRequestSchema.safeParse(req);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      userEndpoints.upsertProfile,
      validated.data
    );
    // API-CONTRACT: data.data is the UserProfileResponse DTO `{ message, user }`.
    const parsed = UserProfileResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.user;
  },

  /**
   * Update the authenticated user's preferred display language. Scoped
   * deliberately to `preferred_locale` only — see `userEndpoints.updateProfile`.
   */
  updatePreferredLocale: async (
    req: UpdatePreferredLocaleInput
  ): Promise<UserProfile> => {
    const validated = UpdatePreferredLocaleSchema.safeParse(req);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      userEndpoints.updateProfile,
      validated.data
    );
    // API-CONTRACT: data.data is `{ user: UserProfile }` — different shape
    // than upsertProfile's `{ message, user }`.
    const parsed = UpdateProfileResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.user;
  },

  /**
   * Permanently delete the authenticated user's account and all associated data.
   */
  deleteAccount: async (): Promise<UserDeleteAccountResponse> => {
    const response = await apiClient.delete(userEndpoints.deleteAccount);
    // API-CONTRACT: data.data is the UserDeleteAccountResponse DTO.
    const parsed = UserDeleteAccountResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },
};
