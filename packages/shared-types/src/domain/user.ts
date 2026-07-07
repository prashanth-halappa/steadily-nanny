// User domain models.

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  user_id: string;
  name: string | null;
  city: string | null;
  country: string | null;
  preferred_locale?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Flexible JSON blob for app-specific profile data. */
  additional_data?: Record<string, unknown> | null;
}
