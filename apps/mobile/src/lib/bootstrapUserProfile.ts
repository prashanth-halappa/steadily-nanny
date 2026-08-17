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

/**
 * The name to PREFILL an input with, as opposed to the name to WRITE.
 *
 * `deriveBootstrapName` falls back to the email local-part and then to
 * "User" so a profile upsert always validates — correct at write time, wrong
 * in a text box. A parent signing up as `parent@…` was landing on "Name your
 * family" with the word "parent" already typed into a field labelled "Your
 * name", and because the field was prefilled they kept it: "parent" then
 * became the name their nanny read on every shift, hour, and payment.
 *
 * Only a name the user actually gave us (Apple/Google `full_name`) is worth
 * prefilling. Anything else should leave the box empty so the placeholder can
 * ask the question.
 */
export function deriveSeedName(user: User | null | undefined): string {
  const meta = user?.user_metadata;
  const fullName =
    typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
  return fullName ? fullName.slice(0, 200) : '';
}

export function buildBootstrapProfileRequest(
  user: User,
  options?: { name?: string }
): UserProfileRequest {
  const trimmed = options?.name?.trim();
  return {
    name: trimmed ? trimmed.slice(0, 200) : deriveBootstrapName(user),
    city: BOOTSTRAP_LOCATION_PLACEHOLDER,
    country: BOOTSTRAP_LOCATION_PLACEHOLDER,
    timezone: getDeviceTimeZone(),
  };
}
