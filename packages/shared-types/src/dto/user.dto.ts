// User DTOs (Data Transfer Objects).
import type { UserProfile } from '../domain/user';

export interface UserProfileRequest {
  name: string;
  city: string;
  country: string;
  /** Flexible JSON blob for app-specific profile data. */
  additional_data?: Record<string, unknown>;
}

export interface UserProfileResponse {
  message: string;
  user: UserProfile;
}

export interface UserDeleteAccountResponse {
  success: boolean;
  message: string;
}
