/**
 * The household's holiday calendar — which of the federal holidays THIS
 * family observes (3-E4, §5 D-12, `docs/design/screens-pay-terms.md` §3/§4.3).
 * @module packages/shared-types/src/schemas/householdHoliday.schema
 *
 * Backing table: `household_holidays` (supabase/migrations/080_holidays.sql).
 *
 * ONE ROW PER (household, holiday_key) — a TOGGLE, not a date. The dates are
 * a pack, resolved per year by `holidayPacks.ts` for the household's country;
 * storing them here would be a second copy of that pack and a row a year to
 * keep right. See that module's header.
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

/**
 * On READ the key is an OPEN string; on WRITE it is the same shape (1..64).
 * Validity now depends on the household's country, which a wire schema
 * cannot see — a CA key is writable for a CA household and refused for a
 * US one. The closed-set gate MOVED to
 * `householdCommandService.setHolidays`; do not conclude it evaporated
 * because this refine is gone.
 */
const HolidayKeyReadSchema = z.string().min(1).max(64);

const HolidayKeyWriteSchema = HolidayKeyReadSchema;

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

// =============================================================================
// household_custom_holidays — household-authored days, not a pack key
// =============================================================================

/**
 * The persisted custom-day row as returned to clients. `dates` are the
 * literal `YYYY-MM-DD`s this family treats as holidays; there is no rule
 * behind them, which is the whole point of a custom day.
 */
export const HouseholdCustomHolidaySchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  name: z.string().min(1).max(60),
  dates: z.array(z.iso.date()).min(1).max(12),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

const CustomHolidayWriteNameSchema = z.string().trim().min(1).max(60);

const CustomHolidayWriteDatesSchema = z
  .array(z.iso.date())
  .min(1)
  .max(12)
  .refine(dates => new Set(dates).size === dates.length, {
    message: 'dates must not repeat',
  });

/**
 * `PUT /households/:householdId/custom-holidays` body — a SET of custom
 * days, replaced wholesale.
 *
 * No `.min(1)`: an empty set is how the last custom day is deleted.
 * `.max(20)` is the ceiling so a household cannot store an unbounded list
 * of dates the engine would then scan every week.
 */
export const SetHouseholdCustomHolidaysRequestSchema = z.object({
  custom_holidays: z
    .array(
      z.object({
        name: CustomHolidayWriteNameSchema,
        dates: CustomHolidayWriteDatesSchema,
      })
    )
    .max(20)
    .refine(
      holidays =>
        new Set(holidays.map(entry => entry.name.toLowerCase())).size ===
        holidays.length,
      { message: 'custom holiday names must not repeat' }
    ),
});

/** List response envelope — this household's authored days. */
export const HouseholdCustomHolidayListResponseSchema = z.object({
  household_custom_holidays: z.array(HouseholdCustomHolidaySchema),
});

export type HouseholdCustomHoliday = z.infer<
  typeof HouseholdCustomHolidaySchema
>;
export type SetHouseholdCustomHolidaysRequest = z.infer<
  typeof SetHouseholdCustomHolidaysRequestSchema
>;
export type HouseholdCustomHolidayListResponse = z.infer<
  typeof HouseholdCustomHolidayListResponseSchema
>;
