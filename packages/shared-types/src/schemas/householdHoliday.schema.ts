/**
 * The household's holiday calendar — which of the federal holidays THIS
 * family observes (3-E4, §5 D-12, `docs/design/screens-pay-terms.md` §3/§4.3).
 * @module packages/shared-types/src/schemas/householdHoliday.schema
 *
 * Backing table: `household_holidays` (supabase/migrations/080_holidays.sql).
 *
 * ONE ROW PER (household, holiday_key) — a TOGGLE, not a date. The dates are
 * a rule, resolved per year by `usFederalHolidays.ts`; storing them here
 * would be a second copy of that rule and eleven more rows a year to keep
 * right. See that module's header.
 *
 * ABSENT MEANS NOT OBSERVED, and that is the null-is-an-explicit-no rule
 * (playbook §2.9) applied to a row set. A household with no rows observes no
 * holidays and pays no premium — the safe direction, and the honest one:
 * nobody has agreed anything yet. Reading absence as "observed" would have
 * every pre-080 household silently start paying a premium on eleven dates
 * nobody chose. New households are SEEDED with the federal set at creation
 * (`householdCommandService.create`), which is what makes the toggles read as
 * "all on" the first time a parent opens the group; §5 D-9 covers the
 * households that predate this migration — the app is pre-launch.
 */

import { z } from 'zod';
import { isUsFederalHolidayKey } from '../usFederalHolidays';

/**
 * On READ the key is an OPEN string; on WRITE it must be one this build
 * knows. The same asymmetry `EarningsLineKind` has, for the same reason: a
 * row written by a newer server (a state holiday, a household-authored day)
 * must still parse on an older client, while a key this build cannot resolve
 * to a date must never be storable — it would be a toggle that prices
 * nothing, forever, silently.
 */
const HolidayKeyReadSchema = z.string().min(1).max(64);

const HolidayKeyWriteSchema = HolidayKeyReadSchema.refine(
  isUsFederalHolidayKey,
  { message: 'holiday_key must be a known US federal holiday key' }
);

/** The persisted row as returned to clients. */
export const HouseholdHolidaySchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  holiday_key: HolidayKeyReadSchema,
  /** True = this family treats the day as a holiday and the premium applies. */
  observed: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/**
 * `PUT /households/:householdId/holidays` body — a SET of toggles, upserted.
 *
 * A set rather than one-at-a-time because the terms screen edits the whole
 * group and saves it (§4.3's group is "a list, not a field"), and because a
 * per-row PATCH would need a row id the client does not have for a key that
 * has never been toggled. Keys not named are left alone, so a client that
 * knows about ten of eleven holidays cannot silently switch off the eleventh.
 */
export const SetHouseholdHolidaysRequestSchema = z.object({
  holidays: z
    .array(
      z.object({
        holiday_key: HolidayKeyWriteSchema,
        observed: z.boolean(),
      })
    )
    .min(1)
    // A duplicate key in one payload is two contradictory instructions about
    // the same day; refuse rather than let last-write-wins pick one
    // (playbook §2.9, refuse-don't-clamp).
    .refine(
      holidays =>
        new Set(holidays.map(entry => entry.holiday_key)).size ===
        holidays.length,
      { message: 'holiday_key must not repeat' }
    ),
});

/** List response envelope — this household's toggles, however many exist. */
export const HouseholdHolidayListResponseSchema = z.object({
  household_holidays: z.array(HouseholdHolidaySchema),
});

export type HouseholdHoliday = z.infer<typeof HouseholdHolidaySchema>;
export type SetHouseholdHolidaysRequest = z.infer<
  typeof SetHouseholdHolidaysRequestSchema
>;
export type HouseholdHolidayListResponse = z.infer<
  typeof HouseholdHolidayListResponseSchema
>;
