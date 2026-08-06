/**
 * @module lib/bootstrapUserProfile
 *
 * Builds the minimum `POST /v1/users/profile` payload for a brand-new auth user
 * who has not completed a profile step. Household rows (and most other domain
 * tables) FK to `user_profiles`, so this must run before the first household
 * create or invite redeem — see GOLDEN-FIXES #7 and migration 009_households.sql.
 */
import type { UserProfileRequest } from '@steadily-nanny/shared-types';
import type { User } from '@supabase/supabase-js';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';

/** Placeholder until the user sets location in settings (mobile client requires non-empty). */
const BOOTSTRAP_LOCATION_PLACEHOLDER = '—';

/**
 * Derive a display name from Supabase auth metadata. Apple only returns
 * `fullName` on the first SIWA grant — fall back to email local-part, then a
 * generic label so upsert validation always passes.
 */
export function deriveBootstrapName(user: User): string {
  const meta = user.user_metadata;
  const fullName =
    typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
  if (fullName) return fullName.slice(0, 200);

  const email =
    user.email ?? (typeof meta?.email === 'string' ? meta.email : '');
  const localPart = email.split('@')[0]?.trim();
  if (localPart) return localPart.slice(0, 200);

  return 'User';
}

export function buildBootstrapProfileRequest(user: User): UserProfileRequest {
  return {
    name: deriveBootstrapName(user),
    city: BOOTSTRAP_LOCATION_PLACEHOLDER,
    country: BOOTSTRAP_LOCATION_PLACEHOLDER,
    timezone: getDeviceTimeZone(),
  };
}
