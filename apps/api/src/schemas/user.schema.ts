/**
 * User request schemas.
 *
 * @module schemas/user.schema
 */
import { z } from 'zod';

/**
 * Whether `value` is a real IANA time zone identifier (e.g. `Europe/London`),
 * not just a non-empty string. `user_profiles.timezone` has no DB CHECK
 * constraint — it's free text — so this is the ONLY gate. A garbage value
 * that slipped past here would reach an `AT TIME ZONE` call downstream
 * (`weekStartOf`, `localDateOf` — see `domains/timesheet/utils/weekStart.ts`)
 * and silently misfile a week boundary, the same class of bug that module's
 * header comment warns about.
 *
 * Two checks, deliberately NOT just `Intl.supportedValuesOf('timeZone')`
 * membership — that list is CANONICAL-only (e.g. it has `Asia/Calcutta` but
 * not the `Asia/Kolkata` alias a real device commonly reports), so using it
 * alone would reject legitimate zones and break onboarding for whole
 * countries:
 *
 * 1. Reject anything starting with `+`/`-` — the signature of a raw
 *    UTC-offset string like `"+01:00"`, which `Intl.DateTimeFormat` also
 *    accepts as a `timeZone` value (a newer ECMA-402 allowance) but which
 *    this app must reject: every other zone field here (`households.timezone`,
 *    `shifts.timezone`, ...) is a real IANA region name specifically because
 *    a fixed offset never observes DST, defeating the entire point of
 *    storing a zone instead of an offset.
 * 2. Construct an `Intl.DateTimeFormat` with the value as `timeZone` inside a
 *    try/catch — it throws a `RangeError` for anything ICU doesn't
 *    recognize, and (unlike `supportedValuesOf`) resolves real aliases
 *    correctly. Dependency-free, matching this codebase's existing
 *    `Intl`-only convention (see `weekStart.ts`, `recurrenceExpander.ts`).
 */
export function isValidIanaTimeZone(value: string): boolean {
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

/** `user_profiles.week_starts_on` — mirrors the DB's `between 0 and 6` check. */
const WEEK_STARTS_ON_FIELD = z.int().min(0).max(6);

export const UpsertProfileSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(200).optional().default(''),
  country: z.string().max(200).optional().default(''),
  additional_data: z.record(z.string(), z.unknown()).optional(),
  // Optional: "seeded from the device" at signup (migration 011's own
  // comment), best-effort — a client that can't detect a zone yet simply
  // omits it and the column stays null. There is no `week_starts_on` here:
  // that field always defaults to Monday (1) at the DB level and this app is
  // en-GB/Monday-first throughout, so there is nothing meaningful to seed.
  timezone: TIMEZONE_FIELD.optional(),
});

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  city: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
  preferred_locale: z.string().max(16).optional(),
  // Per-user display timezone — "different households are in different time
  // zones, each user should be able to set their own." NOTE: `week_starts_on`
  // is accepted and persisted below but is NOT currently read by any
  // week-boundary computation in this codebase — every one of them
  // (`domains/timesheet/utils/weekStart.ts`,
  // `domains/schedule/services/recurrenceExpander.ts`, `utils/dateUtils.ts`)
  // hardcodes Monday-first. Setting it today changes nothing visible; wiring
  // it into those computations is separate, unstarted work.
  timezone: TIMEZONE_FIELD.optional(),
  week_starts_on: WEEK_STARTS_ON_FIELD.optional(),
});

export type UpsertProfileInput = z.infer<typeof UpsertProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
