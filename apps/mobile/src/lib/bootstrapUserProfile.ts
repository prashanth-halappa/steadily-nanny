/**
 * @module lib/bootstrapUserProfile
 *
 * Builds the minimum `POST /v1/users/profile` payload for a brand-new auth user
 * who has not completed a profile step. Household rows (and most other domain
 * tables) FK to `user_profiles`, so this must run before the first household
 * create or invite redeem — see GOLDEN-FIXES #7 and migration 009_households.sql.
 */
import type { UserProfileRequest } from '@steadily-nanny/shared-types';
import type { AuthUser } from '@/src/lib/authClient';
import { getDeviceTimeZone } from '@/src/lib/deviceTimeZone';

/** Placeholder until the user sets location in settings (mobile client requires non-empty). */
const BOOTSTRAP_LOCATION_PLACEHOLDER = '—';

/**
 * Derive a display name from the auth user. Apple only returns `fullName` on
 * the first SIWA grant (and Better Auth stores " " when it has none) — fall
 * back to email local-part, then a generic label so upsert validation always
 * passes.
 */
export function deriveBootstrapName(user: AuthUser): string {
  const fullName = deriveSeedName(user);
  if (fullName) return fullName;

  const localPart = (user.email ?? '').split('@')[0]?.trim();
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
 * Only a name the user actually gave us (Apple/Google, via `user.name`) is worth
 * prefilling. Anything else should leave the box empty so the placeholder can
 * ask the question.
 */
export function deriveSeedName(user: AuthUser | null | undefined): string {
  return (user?.name ?? '').trim().slice(0, 200);
}

export function buildBootstrapProfileRequest(
  user: AuthUser,
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
