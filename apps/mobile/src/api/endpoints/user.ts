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
import { PhoneNumberSchema } from '@steadily-nanny/shared-types/schemas/contact.schema';
import {
  type HouseholdMember,
  HouseholdMemberListResponseSchema,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// --- Endpoint URLs ----------------------------------------------------------
export const userEndpoints = {
  // API-CONTRACT: GET returns the caller's own profile (auth resolves identity).
  getProfile: '/v1/users/me',
  // API-CONTRACT: POST create-or-update (upsert) of the caller's profile.
  upsertProfile: '/v1/users/profile',
  // API-CONTRACT: PATCH partial-updates the caller's profile.
  updateProfile: '/v1/users/me',
  // API-CONTRACT: DELETE removes the caller's account and all associated data.
  deleteAccount: '/v1/users/me',
  // API-CONTRACT: GET returns EVERY membership row for the caller, including
  // `status: 'removed'` ones — `useIsOnboarded` needs those to tell a removed
  // member from a brand-new user and to drive its read-only write gate.
  listMemberships: '/v1/users/me/memberships',
} as const;

// --- Zod schemas ------------------------------------------------------------

/** Same IANA gate as `apps/api/src/schemas/user.schema.ts` — reject offsets. */
function isValidIanaTimeZone(value: string): boolean {
  if (value.startsWith('+') || value.startsWith('-')) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const TIMEZONE_FIELD = z.string().min(1).max(100).refine(isValidIanaTimeZone, {
  message: 'timezone must be a valid IANA time zone identifier',
});

// API-CONTRACT: mirrors the `UserProfile` domain model. `user_id` is always
// present; the display fields may be null until the profile is completed.
const UserProfileSchema = z.object({
  user_id: z.string(),
  name: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  preferred_locale: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  week_starts_on: z.number().int().min(0).max(6).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  additional_data: z.record(z.string(), z.unknown()).nullable().optional(),
});

// API-CONTRACT: GET /v1/users/me, POST /v1/users/profile, and PATCH return
// `{ user: UserProfile | null }` inside the success envelope's `data`.
// (`message` lives on the outer envelope, not inside `data`.)
const UserEnvelopeSchema = z.object({
  user: UserProfileSchema.nullable(),
});

// API-CONTRACT: DELETE /v1/users returns the `UserDeleteAccountResponse` DTO
// (`{ success }`) inside the success envelope's `data`. The human-readable
// message ("Account deleted") lives on the envelope itself, not in `data` —
// same split every other endpoint in this module uses (see `UserEnvelopeSchema`
// above). F-B7-1: `data` never carried `message`, so requiring it here made
// every successful delete look like a validation failure.
const UserDeleteAccountResponseSchema = z.object({
  success: z.boolean(),
});

// Outgoing profile upsert payload — validated client-side before the request.
const UserProfileRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  city: z.string().min(1, 'City is required'),
  country: z.string().min(1, 'Country is required'),
  additional_data: z.record(z.string(), z.unknown()).optional(),
  timezone: TIMEZONE_FIELD.optional(),
  // Zod strips unknown keys, so a field absent here is dropped silently
  // between the screen and the wire — the onboarding mutation looks correct
  // and the number never arrives. Same definition the server validates with.
  phone: PhoneNumberSchema.optional(),
});

const UpdatePreferredLocaleSchema = z.object({
  preferred_locale: z.string().min(1).max(16),
});
export type UpdatePreferredLocaleInput = z.infer<
  typeof UpdatePreferredLocaleSchema
>;

const UpdateNameSchema = z.object({
  name: z.string().min(1).max(200),
});
export type UpdateNameInput = z.infer<typeof UpdateNameSchema>;

const UpdateTimeSettingsSchema = z
  .object({
    timezone: TIMEZONE_FIELD.optional(),
    week_starts_on: z.number().int().min(0).max(6).optional(),
  })
  .refine(
    data => data.timezone !== undefined || data.week_starts_on !== undefined,
    { message: 'At least one of timezone or week_starts_on is required' }
  );
export type UpdateTimeSettingsInput = z.infer<typeof UpdateTimeSettingsSchema>;

// --- API --------------------------------------------------------------------
export const userApi = {
  /**
   * Fetch the authenticated user's profile.
   */
  getProfile: async (): Promise<UserProfile | null> => {
    const response = await apiClient.get(userEndpoints.getProfile);
    // API-CONTRACT: GET /users/me returns `{ user }` inside data.data.
    const parsed = UserEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.user;
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
    // API-CONTRACT: data.data is `{ user }` — same envelope as GET /users/me.
    const parsed = UserEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    if (!parsed.data.user) {
      throw new Error('Profile upsert succeeded but returned no user');
    }
    return parsed.data.user;
  },

  /**
   * Update the authenticated user's preferred display language.
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
    const parsed = UserEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    if (!parsed.data.user) {
      throw new Error('Locale update succeeded but returned no user');
    }
    return parsed.data.user;
  },

  /**
   * Update the caller's display name.
   */
  updateName: async (req: UpdateNameInput): Promise<UserProfile> => {
    const validated = UpdateNameSchema.safeParse(req);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      userEndpoints.updateProfile,
      validated.data
    );
    const parsed = UserEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    if (!parsed.data.user) {
      throw new Error('Name update succeeded but returned no user');
    }
    return parsed.data.user;
  },

  /**
   * Update the caller's display timezone and/or week-start preference (D29).
   * Presentation lens only — `user_profiles.week_starts_on` rotates calendar
   * column order for this user and never moves a week boundary. Business
   * weeks are anchored on `households.week_starts_on`.
   */
  updateTimeSettings: async (
    req: UpdateTimeSettingsInput
  ): Promise<UserProfile> => {
    const validated = UpdateTimeSettingsSchema.safeParse(req);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      userEndpoints.updateProfile,
      validated.data
    );
    const parsed = UserEnvelopeSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    if (!parsed.data.user) {
      throw new Error('Time settings update succeeded but returned no user');
    }
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

  /** Every household membership row for the signed-in user. */
  listMemberships: async (): Promise<HouseholdMember[]> => {
    const response = await apiClient.get(userEndpoints.listMemberships);
    const parsed = HouseholdMemberListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.household_members;
  },
};
