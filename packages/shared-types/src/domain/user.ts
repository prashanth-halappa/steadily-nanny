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
  /**
   * `user_profiles.phone` (099) — this person's own mobile number, as they
   * typed it. Free text, never normalised to E.164; validated loosely at the
   * wire edge by `PhoneNumberSchema`
   * (`packages/shared-types/src/schemas/contact.schema.ts`), which is the
   * only gate the column has.
   *
   * NOT READABLE BY CO-MEMBERS THROUGH RLS — 002's owner-only policies on
   * `user_profiles` are untouched by 099. A co-member sees it only as the
   * joined `HouseholdMember.profile_phone` on the household members read, and
   * only when both parties are ACTIVE members of that household.
   *
   * OPTIONAL here for the same reason as `timezone` below — existing
   * construction sites predate it.
   */
  phone?: string | null;
  /**
   * The user's own IANA time zone (e.g. `Europe/London`), "seeded from the
   * device" at signup — display only, never a source of truth for a stored
   * instant. Null until set. Validated server-side against the real IANA
   * database (`isValidIanaTimeZone` in `apps/api/src/schemas/user.schema.ts`)
   * — there is no DB CHECK constraint on this column, so a free-text value
   * that skipped that validation would silently misfile every week-boundary
   * computation that reads it.
   *
   * OPTIONAL here (though the API always returns it, null or not) —
   * deliberately, so existing callers that construct a `UserProfile` without
   * this field (it's new — see D29) keep type-checking. Do not tighten to
   * required without checking every construction site first.
   */
  timezone?: string | null;
  /**
   * 0 (Sunday) .. 6 (Saturday), matching Postgres `extract(dow)`. Defaults to
   * 1 (Monday) at the DB level — NOTE: not currently read by any
   * week-boundary computation in this codebase (every one of them hardcodes
   * Monday-first, matching the product's en-GB locale) — persisted for a
   * future per-user override, inert today.
   *
   * OPTIONAL here for the same reason as `timezone` above.
   */
  week_starts_on?: number;
  created_at?: string;
  updated_at?: string;
  /** Flexible JSON blob for app-specific profile data. */
  additional_data?: Record<string, unknown> | null;
}
