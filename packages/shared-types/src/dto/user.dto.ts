// User DTOs (Data Transfer Objects).
import type { UserProfile } from '../domain/user';

export interface UserProfileRequest {
  name: string;
  city: string;
  country: string;
  /** Flexible JSON blob for app-specific profile data. */
  additional_data?: Record<string, unknown>;
  /** Optional — "seeded from the device" at signup. See `UserProfile.timezone`. */
  timezone?: string;
}

export interface UserProfileResponse {
  message: string;
  user: UserProfile;
}

// F-B7-1: matches the API's `data` payload exactly — the human-readable
// message lives on the response envelope (`sendSuccessResponse`'s message
// arg), never duplicated inside `data`. See every other controller in this
// repo (e.g. `expenseController.ts`'s `'Expense withdrawn'` + `{}`) for the
// same split.
export interface UserDeleteAccountResponse {
  success: boolean;
}
