/**
 * The one phone-number field definition in the product (099).
 *
 * @module packages/shared-types/src/schemas/contact.schema
 *
 * Backing columns: `user_profiles.phone`, `households.emergency_contact_phone`
 * (supabase/migrations/099_contact_fields.sql). Both are free text with no DB
 * CHECK, so this schema is the only gate either one has — and it is
 * deliberately a loose one.
 */

import { z } from 'zod';

/**
 * Everything a phone number is allowed to be made of: an optional leading
 * `+`, then digits and the punctuation people actually type — spaces,
 * hyphens, dots, and parentheses around an area or trunk code.
 */
const PHONE_SHAPE = /^\+?[\d\s().-]+$/;

/** The fewest digits that could plausibly be somebody's number. */
const MIN_DIGITS = 5;

/**
 * A phone number, as a human types it.
 *
 * NOT E.164, and never normalised to it. A UK parent types "07700 900123"
 * and an app that answers "that isn't a valid phone number" has failed at
 * the one field that matters when a child is hurt. The same goes for
 * "+1 (415) 555-0134" and "020 7946 0018" — every one of those is the right
 * answer to "your number", and none of them survives a strict validator.
 *
 * So the gate asks only "is this a phone number at all", in two checks that
 * between them reject the things that are genuinely not one:
 *
 * - `PHONE_SHAPE` rejects anything with a letter in it — "call me", "ask
 *   Amara", "07700-CALLME" — which is the realistic junk, someone answering
 *   the question in prose instead of digits.
 * - `MIN_DIGITS` rejects "1234" and "(((-)))" — too few digits to dial,
 *   whether that is a typo or punctuation on its own.
 *
 * 32 characters is the ceiling, applied AFTER trimming: the longest real
 * international number with spaces and an extension is comfortably inside
 * it, and the column is text with no length constraint of its own.
 *
 * `.trim()` runs first so leading/trailing whitespace from a paste never
 * reaches the database and never counts against the length.
 */
export const PhoneNumberSchema = z
  .string()
  .trim()
  .max(32, 'phone must be 32 characters or fewer')
  .regex(PHONE_SHAPE, 'phone must be a number, not words')
  .refine(
    value => (value.match(/\d/g) ?? []).length >= MIN_DIGITS,
    `phone must contain at least ${MIN_DIGITS} digits`
  );
