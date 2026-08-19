/**
 * @module packages/shared-types/tests/householdHoliday.schema.test
 * The household holiday calendar's wire contract (3-E4, §5 D-12).
 */
import { describe, expect, it } from 'bun:test';
import {
  HouseholdCustomHolidayListResponseSchema,
  HouseholdCustomHolidaySchema,
  HouseholdHolidayListResponseSchema,
  HouseholdHolidaySchema,
  SetHouseholdCustomHolidaysRequestSchema,
  SetHouseholdHolidaysRequestSchema,
} from '../src/schemas/householdHoliday.schema';
import { US_FEDERAL_HOLIDAY_KEYS } from '../src/usFederalHolidays';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

/** Both serialisations of the same instant must parse (GOLDEN-FIXES #25). */
const OFFSET_FORM = '2026-08-01T08:00:00+00:00';
const ZULU_FORM = '2026-08-01T08:00:00.000Z';

const validRow = {
  id: VALID_UUID,
  household_id: VALID_UUID,
  holiday_key: 'independence_day',
  observed: true,
  created_at: OFFSET_FORM,
  updated_at: ZULU_FORM,
};

describe('HouseholdHolidaySchema', () => {
  it('parses a row', () => {
    expect(HouseholdHolidaySchema.safeParse(validRow).success).toBe(true);
  });

  it('parses both timestamp serialisations on both columns', () => {
    for (const created_at of [OFFSET_FORM, ZULU_FORM]) {
      for (const updated_at of [OFFSET_FORM, ZULU_FORM]) {
        expect(
          HouseholdHolidaySchema.safeParse({
            ...validRow,
            created_at,
            updated_at,
          }).success
        ).toBe(true);
      }
    }
  });

  it('parses an observed:false row — the family opted this day OUT', () => {
    const parsed = HouseholdHolidaySchema.safeParse({
      ...validRow,
      observed: false,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.observed).toBe(false);
  });

  it('READS a key this build has never heard of', () => {
    // Same tolerance as an unknown `EarningsLineKind`: a row written by a
    // newer server (a state holiday, a custom day) must not fail the whole
    // response — the client can render what it knows and leave the rest.
    expect(
      HouseholdHolidaySchema.safeParse({
        ...validRow,
        holiday_key: 'cesar_chavez_day',
      }).success
    ).toBe(true);
  });

  it('rejects an empty key', () => {
    expect(
      HouseholdHolidaySchema.safeParse({ ...validRow, holiday_key: '' }).success
    ).toBe(false);
  });

  it('envelopes a list', () => {
    expect(
      HouseholdHolidayListResponseSchema.safeParse({
        household_holidays: [validRow],
      }).success
    ).toBe(true);
    expect(
      HouseholdHolidayListResponseSchema.safeParse({ household_holidays: [] })
        .success
    ).toBe(true);
  });
});

describe('SetHouseholdHolidaysRequestSchema', () => {
  it('accepts a set of toggles', () => {
    const parsed = SetHouseholdHolidaysRequestSchema.safeParse({
      holidays: [
        { holiday_key: 'independence_day', observed: true },
        { holiday_key: 'columbus_day', observed: false },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.holidays).toHaveLength(2);
  });

  it('no longer refuses an unknown key — country-validity is the service’s', () => {
    // Closed-set gate moved to householdCommandService.setHolidays; a wire
    // schema cannot see the household's country, so a CA key on a US
    // household (and the reverse) is the service's to refuse.
    expect(
      SetHouseholdHolidaysRequestSchema.safeParse({
        holidays: [{ holiday_key: 'st_swithins_day', observed: true }],
      }).success
    ).toBe(true);
  });

  it('refuses a duplicate key rather than letting last-write-wins pick one', () => {
    expect(
      SetHouseholdHolidaysRequestSchema.safeParse({
        holidays: [
          { holiday_key: 'labor_day', observed: true },
          { holiday_key: 'labor_day', observed: false },
        ],
      }).success
    ).toBe(false);
  });

  it('refuses an empty payload — a PUT that says nothing is a mistake', () => {
    expect(
      SetHouseholdHolidaysRequestSchema.safeParse({ holidays: [] }).success
    ).toBe(false);
  });

  it('accepts every federal key', () => {
    // Guards the two modules drifting: a key renamed in `usFederalHolidays`
    // and not here would be un-writable while still rendering on the screen.
    expect(
      SetHouseholdHolidaysRequestSchema.safeParse({
        holidays: US_FEDERAL_HOLIDAY_KEYS.map(holiday_key => ({
          holiday_key,
          observed: true,
        })),
      }).success
    ).toBe(true);
  });
});

const validCustomRow = {
  id: VALID_UUID,
  household_id: VALID_UUID,
  name: 'Family Day',
  dates: ['2026-02-16'],
  created_at: OFFSET_FORM,
  updated_at: ZULU_FORM,
};

describe('HouseholdCustomHolidaySchema', () => {
  it('parses a row', () => {
    expect(HouseholdCustomHolidaySchema.safeParse(validCustomRow).success).toBe(
      true
    );
  });

  it('envelopes a list', () => {
    expect(
      HouseholdCustomHolidayListResponseSchema.safeParse({
        household_custom_holidays: [validCustomRow],
      }).success
    ).toBe(true);
  });
});

describe('SetHouseholdCustomHolidaysRequestSchema', () => {
  it('ACCEPTS an empty set — that is how the last custom day is deleted', () => {
    expect(
      SetHouseholdCustomHolidaysRequestSchema.safeParse({
        custom_holidays: [],
      }).success
    ).toBe(true);
  });

  it('accepts a named custom day with dates', () => {
    const parsed = SetHouseholdCustomHolidaysRequestSchema.safeParse({
      custom_holidays: [{ name: 'Family Day', dates: ['2026-02-16'] }],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses empty dates', () => {
    expect(
      SetHouseholdCustomHolidaysRequestSchema.safeParse({
        custom_holidays: [{ name: 'Family Day', dates: [] }],
      }).success
    ).toBe(false);
  });

  it('refuses duplicate dates', () => {
    expect(
      SetHouseholdCustomHolidaysRequestSchema.safeParse({
        custom_holidays: [
          { name: 'Family Day', dates: ['2026-02-16', '2026-02-16'] },
        ],
      }).success
    ).toBe(false);
  });

  it('refuses duplicate names, case-insensitively after trim', () => {
    expect(
      SetHouseholdCustomHolidaysRequestSchema.safeParse({
        custom_holidays: [
          { name: 'Family Day', dates: ['2026-02-16'] },
          { name: ' family day ', dates: ['2027-02-15'] },
        ],
      }).success
    ).toBe(false);
  });

  it('refuses a 61-char name', () => {
    expect(
      SetHouseholdCustomHolidaysRequestSchema.safeParse({
        custom_holidays: [{ name: 'a'.repeat(61), dates: ['2026-02-16'] }],
      }).success
    ).toBe(false);
  });
});
