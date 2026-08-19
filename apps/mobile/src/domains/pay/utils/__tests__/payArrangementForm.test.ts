/**
 * @module domains/pay/utils/__tests__/payArrangementForm
 *
 * Case table for the pure request-building/date logic — the "careful spot"
 * TIER0-PLAN.md flags for this slice (mid-week rate split, no-future-dates,
 * the household-window-0-maps-to-no-pay rule).
 */
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import i18n from '@/src/i18n';
import {
  buildCreatePayArrangementRequest,
  buildMidWeekConsequence,
  defaultCancellationChoiceFromHouseholdWindow,
  formatDisplayDateWithYear,
  formatShortDate,
  formatWeekdayLong,
  isValidCalendarDate,
  isWeekStartDay,
  type PayTermsFormState,
  parseHoursToMinutes,
} from '../payArrangementForm';

const baseState: PayTermsFormState = {
  rateText: '18.50',
  currency: 'GBP',
  effectiveDateISO: '2026-08-04',
  todayISO: '2026-08-04',
  overtimeThresholdHoursText: '',
  overtimeMultiplierText: '1.50',
  holidayHoursText: '',
  dailyOvertimeThresholdHoursText: '',
  doubletimeThresholdHoursText: '',
  doubletimeMultiplierText: '',
  seventhDayMultiplierText: '',
  seventhDayDoubletimeAfterHoursText: '',
  workedHolidayMultiplierText: '',
  guaranteedHoursText: '',
  ptoHoursPerYearText: '',
  mileageRateText: '',
  cancellationChoice: 'none',
  cancellationHoursText: '',
  note: '',
  payFrequency: '',
  payDayOfWeekText: '',
  payDayOfMonthText: '',
};

const payTermsGroupsPath = join(__dirname, '../../components/PayTermsGroups.tsx');
let payTermsGroupsSource = '';

beforeAll(async () => {
  payTermsGroupsSource = await Bun.file(payTermsGroupsPath).text();
});

describe('isValidCalendarDate', () => {
  it('accepts a real date', () => {
    expect(isValidCalendarDate('2026-08-04')).toBe(true);
  });

  it('rejects a rolled-over date like Feb 30', () => {
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidCalendarDate('4 Aug 2026')).toBe(false);
    expect(isValidCalendarDate('')).toBe(false);
  });
});

// 3-E1: the "does this change split a week" question is asked against the
// HOUSEHOLD's `week_starts_on`, not a hardcoded Monday. For a Sunday-start
// household a Monday change DOES split the week, and a Sunday one does not
// — exactly inverted from what the old `isMonday` reported.
describe('isWeekStartDay', () => {
  it('2026-08-03 (Monday) is the week start for a Monday-start household', () => {
    expect(isWeekStartDay('2026-08-03', 1)).toBe(true);
    expect(isWeekStartDay('2026-08-04', 1)).toBe(false);
  });

  it('2026-08-02 (Sunday) is the week start for a Sunday-start household', () => {
    expect(isWeekStartDay('2026-08-02', 0)).toBe(true);
    // The day a Monday-start household would call a clean boundary.
    expect(isWeekStartDay('2026-08-03', 0)).toBe(false);
  });

  it('2026-08-01 (Saturday) is the week start for a Saturday-start household', () => {
    expect(isWeekStartDay('2026-08-01', 6)).toBe(true);
    expect(isWeekStartDay('2026-08-03', 6)).toBe(false);
  });

  it('rejects a non-date rather than guessing a weekday', () => {
    expect(isWeekStartDay('2026-02-30', 1)).toBe(false);
    expect(isWeekStartDay('', 1)).toBe(false);
  });
});

// §2.6 / D-4 — en-US, month-before-day, locale-aware (was hand-rolled
// en-GB-shaped arrays).
describe('formatWeekdayLong / formatShortDate / formatDisplayDateWithYear', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('formats a full weekday date, en-US order', () => {
    expect(formatWeekdayLong('2026-09-03')).toBe('Thursday, September 3');
  });

  it('formats a short no-year date, month before day', () => {
    expect(formatShortDate('2026-08-04')).toBe('Aug 4');
  });

  it('formats a date with year, month before day', () => {
    expect(formatDisplayDateWithYear('2026-04-01')).toBe('Apr 1, 2026');
  });

  it('localises to Spanish word order and names, not just the words', async () => {
    await i18n.changeLanguage('es');
    expect(formatWeekdayLong('2026-09-03')).toBe('jueves, 3 de septiembre');
    expect(formatShortDate('2026-08-04')).toBe('4 ago');
    expect(formatDisplayDateWithYear('2026-04-01')).toBe('1 abr 2026');
  });
});

describe('parseHoursToMinutes', () => {
  it('converts whole hours', () => {
    expect(parseHoursToMinutes('40')).toBe(2400);
  });

  it('converts fractional hours', () => {
    expect(parseHoursToMinutes('1.5')).toBe(90);
  });

  it('blank text is null (the "not set" state, not an error)', () => {
    expect(parseHoursToMinutes('')).toBeNull();
    expect(parseHoursToMinutes('   ')).toBeNull();
  });

  it('rejects non-numeric and negative text', () => {
    expect(parseHoursToMinutes('abc')).toBeNull();
    expect(parseHoursToMinutes('-1')).toBeNull();
  });
});

describe('defaultCancellationChoiceFromHouseholdWindow (review finding 10)', () => {
  it('a household window of 0 maps to "no cancellation pay"', () => {
    expect(defaultCancellationChoiceFromHouseholdWindow(0)).toBe('none');
  });

  it('a positive window maps to "window"', () => {
    expect(defaultCancellationChoiceFromHouseholdWindow(24)).toBe('window');
  });
});

describe('buildCreatePayArrangementRequest', () => {
  it('builds a minimal valid request (no overtime, no cancellation pay)', () => {
    const result = buildCreatePayArrangementRequest(baseState);
    expect(result).toEqual({
      rate_minor: 1850,
      currency: 'GBP',
      overtime_threshold_minutes: null,
      overtime_multiplier: 1.5,
      guaranteed_minutes_per_week: null,
      pto_entitlement_minutes_per_year: null,
      mileage_rate_per_mile_minor: null,
      overtime_daily_threshold_minutes: null,
      doubletime_daily_threshold_minutes: null,
      doubletime_multiplier: null,
      seventh_day_multiplier: null,
      seventh_day_doubletime_after_minutes: null,
      worked_holiday_multiplier: null,
      holiday_hours_minutes: null,
      pay_frequency: null,
      pay_day_of_week: null,
      pay_day_of_month: null,
      cancellation_paid_within_hours: null,
      valid_from: '2026-08-04',
      terms: {},
      note: undefined,
    });
  });

  it('builds a full request with every term set', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      overtimeThresholdHoursText: '40',
      overtimeMultiplierText: '1.5',
      dailyOvertimeThresholdHoursText: '8',
      doubletimeThresholdHoursText: '12',
      doubletimeMultiplierText: '2',
      seventhDayMultiplierText: '1.5',
      seventhDayDoubletimeAfterHoursText: '8',
      workedHolidayMultiplierText: '1.5',
      holidayHoursText: '8',
      guaranteedHoursText: '40',
      ptoHoursPerYearText: '140',
      mileageRateText: '0.45',
      cancellationChoice: 'window',
      cancellationHoursText: '24',
      note: '  Annual review  ',
      payFrequency: 'biweekly',
      payDayOfWeekText: '5',
    });
    expect(result).toEqual({
      rate_minor: 1850,
      currency: 'GBP',
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      overtime_daily_threshold_minutes: 480,
      doubletime_daily_threshold_minutes: 720,
      doubletime_multiplier: 2,
      seventh_day_multiplier: 1.5,
      seventh_day_doubletime_after_minutes: 480,
      worked_holiday_multiplier: 1.5,
      holiday_hours_minutes: 480,
      pay_frequency: 'biweekly',
      pay_day_of_week: 5,
      pay_day_of_month: null,
      guaranteed_minutes_per_week: 2400,
      pto_entitlement_minutes_per_year: 8400,
      mileage_rate_per_mile_minor: 45,
      cancellation_paid_within_hours: 24,
      valid_from: '2026-08-04',
      terms: {},
      note: 'Annual review',
    });
  });

  it('rejects an unparsable rate', () => {
    expect(
      buildCreatePayArrangementRequest({ ...baseState, rateText: '18.999' })
    ).toBeNull();
  });

  it('rejects a zero hourly rate', () => {
    expect(
      buildCreatePayArrangementRequest({ ...baseState, rateText: '0' })
    ).toBeNull();
  });

  // D-16 reverses the old no-future-dating rule (owner decision 4): a
  // scheduled raise is now the normal case, bounded by a 12-month horizon
  // in the OPPOSITE direction (spec §6).
  it('accepts a scheduled future effective date', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        effectiveDateISO: '2026-08-05',
        todayISO: '2026-08-04',
      })?.valid_from
    ).toBe('2026-08-05');
  });

  it('accepts a future date exactly on the 12-month horizon', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        effectiveDateISO: '2027-08-04',
        todayISO: '2026-08-04',
      })?.valid_from
    ).toBe('2027-08-04');
  });

  it('rejects a future date more than 12 months out', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        effectiveDateISO: '2027-08-05',
        todayISO: '2026-08-04',
      })
    ).toBeNull();
  });

  it('accepts a past effective date', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        effectiveDateISO: '2026-07-01',
        todayISO: '2026-08-04',
      })?.valid_from
    ).toBe('2026-07-01');
  });

  it('requires an explicit cancellation choice — null choice is invalid, never defaults silently', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        cancellationChoice: null,
      })
    ).toBeNull();
  });

  it('rejects an empty cancellation-window hours field when "window" is chosen', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        cancellationChoice: 'window',
        cancellationHoursText: '',
      })
    ).toBeNull();
  });

  it('an overtime threshold without a valid multiplier is rejected', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        overtimeThresholdHoursText: '40',
        overtimeMultiplierText: '0.5', // below the schema's >= 1 floor
      })
    ).toBeNull();
  });

  describe('multiplier bounds mirror OvertimeMultiplierSchema (numeric(3,2))', () => {
    const withMultiplier = (overtimeMultiplierText: string) =>
      buildCreatePayArrangementRequest({
        ...baseState,
        overtimeThresholdHoursText: '40',
        overtimeMultiplierText,
      });

    it('rejects a multiplier above the numeric(3,2) ceiling before the network call', () => {
      expect(withMultiplier('50')).toBeNull();
    });

    it('rejects a three-decimal multiplier the column would silently round', () => {
      expect(withMultiplier('1.555')).toBeNull();
    });

    it('accepts the ceiling itself, 9.99', () => {
      expect(withMultiplier('9.99')?.overtime_multiplier).toBe(9.99);
    });

    it('accepts 8.88, which a naive multipleOf(0.01) check would reject', () => {
      expect(withMultiplier('8.88')?.overtime_multiplier).toBe(8.88);
    });
  });

  describe('review finding 6: blank-threshold multiplier', () => {
    it('carries the CURRENT arrangement multiplier through unchanged on a rate-only change, never hardcoding 1.5', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        rateText: '19.00',
        overtimeThresholdHoursText: '',
        overtimeMultiplierText: '1.50', // stale/irrelevant typed text, threshold blank
        currentOvertimeMultiplier: 2.0,
      });
      expect(result?.overtime_multiplier).toBe(2.0);
      expect(result?.overtime_threshold_minutes).toBeNull();
    });

    it('defaults to 1.5 when there is no current arrangement at all (first-ever setup)', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        overtimeThresholdHoursText: '',
      });
      expect(result?.overtime_multiplier).toBe(1.5);
    });

    it('a typed threshold still uses the typed multiplier, current arrangement or not', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        overtimeThresholdHoursText: '40',
        overtimeMultiplierText: '1.75',
        currentOvertimeMultiplier: 2.0,
      });
      expect(result?.overtime_multiplier).toBe(1.75);
    });
  });

  // 3-E2 / migration 078. Every rule below is a refusal, never a correction:
  // the builder returns `null` and the screen's save button stays disabled,
  // rather than quietly storing a tier nobody agreed to (playbook §2.9).
  describe('078 daily tiers and the seventh day', () => {
    it('carries all five keys explicitly even when every tier is off (T17: a field that is never sent is a field that never persists)', () => {
      const result = buildCreatePayArrangementRequest(baseState);
      expect(result).toHaveProperty('overtime_daily_threshold_minutes', null);
      expect(result).toHaveProperty('doubletime_daily_threshold_minutes', null);
      expect(result).toHaveProperty('doubletime_multiplier', null);
      expect(result).toHaveProperty('seventh_day_multiplier', null);
      expect(result).toHaveProperty(
        'seventh_day_doubletime_after_minutes',
        null
      );
    });

    it('a daily overtime threshold alone is enough — it reuses overtime_multiplier, it has none of its own', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        overtimeThresholdHoursText: '40',
        overtimeMultiplierText: '1.5',
        dailyOvertimeThresholdHoursText: '8',
      });
      expect(result?.overtime_daily_threshold_minutes).toBe(480);
      expect(result?.overtime_multiplier).toBe(1.5);
      expect(result?.doubletime_multiplier).toBeNull();
    });

    it('rejects an unparsable daily overtime threshold', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          dailyOvertimeThresholdHoursText: 'eight',
        })
      ).toBeNull();
    });

    it('rejects a zero daily overtime threshold — 078 checks > 0, and "after 0 hours" is not a tier', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          dailyOvertimeThresholdHoursText: '0',
        })
      ).toBeNull();
    });

    it('rejects a daily overtime threshold of 24 hours or more', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          dailyOvertimeThresholdHoursText: '24',
        })
      ).toBeNull();
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          dailyOvertimeThresholdHoursText: '25',
        })
      ).toBeNull();
    });

    it('rejects a double-time threshold with no double-time multiplier (078 doubletime_daily_needs_multiplier)', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          doubletimeThresholdHoursText: '12',
          doubletimeMultiplierText: '',
        })
      ).toBeNull();
    });

    it('rejects a double-time multiplier outside the numeric(3,2) bounds, same check as the weekly one', () => {
      const withDoubletimeMultiplier = (doubletimeMultiplierText: string) =>
        buildCreatePayArrangementRequest({
          ...baseState,
          doubletimeThresholdHoursText: '12',
          doubletimeMultiplierText,
        });
      expect(withDoubletimeMultiplier('0.5')).toBeNull();
      expect(withDoubletimeMultiplier('50')).toBeNull();
      expect(withDoubletimeMultiplier('1.555')).toBeNull();
      expect(withDoubletimeMultiplier('9.99')?.doubletime_multiplier).toBe(
        9.99
      );
      expect(withDoubletimeMultiplier('8.88')?.doubletime_multiplier).toBe(
        8.88
      );
    });

    it('rejects inverted daily tiers — double time must come strictly after daily overtime (078 daily_tiers_ordered)', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          dailyOvertimeThresholdHoursText: '8',
          doubletimeThresholdHoursText: '6',
          doubletimeMultiplierText: '2',
        })
      ).toBeNull();
    });

    it('rejects EQUAL daily tiers — the constraint is strictly greater, not greater-or-equal', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          dailyOvertimeThresholdHoursText: '8',
          doubletimeThresholdHoursText: '8',
          doubletimeMultiplierText: '2',
        })
      ).toBeNull();
    });

    it('accepts a double-time tier with no daily overtime tier — the ordering rule only bites when both are set', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        doubletimeThresholdHoursText: '12',
        doubletimeMultiplierText: '2',
      });
      expect(result?.doubletime_daily_threshold_minutes).toBe(720);
      expect(result?.overtime_daily_threshold_minutes).toBeNull();
    });

    it('rejects a double-time threshold of 24 hours or more', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          doubletimeThresholdHoursText: '24',
          doubletimeMultiplierText: '2',
        })
      ).toBeNull();
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          doubletimeThresholdHoursText: '25',
          doubletimeMultiplierText: '2',
        })
      ).toBeNull();
    });

    it('a single-tier seventh day needs only its own multiplier', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        seventhDayMultiplierText: '1.5',
      });
      expect(result?.seventh_day_multiplier).toBe(1.5);
      expect(result?.seventh_day_doubletime_after_minutes).toBeNull();
    });

    it('rejects a seventh-day second tier with no seventh-day multiplier (078 seventh_day_second_tier_needs_multiplier)', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          seventhDayMultiplierText: '',
          seventhDayDoubletimeAfterHoursText: '8',
          doubletimeMultiplierText: '2',
        })
      ).toBeNull();
    });

    it('rejects a seventh-day second tier with no double-time multiplier to pay it at', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          seventhDayMultiplierText: '1.5',
          seventhDayDoubletimeAfterHoursText: '8',
          doubletimeMultiplierText: '',
        })
      ).toBeNull();
    });

    it('accepts a two-tier seventh day when both multipliers are present, with no daily double-time threshold at all', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        seventhDayMultiplierText: '1.5',
        seventhDayDoubletimeAfterHoursText: '8',
        doubletimeMultiplierText: '2',
      });
      expect(result?.seventh_day_multiplier).toBe(1.5);
      expect(result?.seventh_day_doubletime_after_minutes).toBe(480);
      expect(result?.doubletime_multiplier).toBe(2);
      expect(result?.doubletime_daily_threshold_minutes).toBeNull();
    });

    it('rejects a seventh-day multiplier outside the numeric(3,2) bounds', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          seventhDayMultiplierText: '1.555',
        })
      ).toBeNull();
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          seventhDayMultiplierText: '0.5',
        })
      ).toBeNull();
    });

    it('rejects a zero seventh-day second-tier threshold', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          seventhDayMultiplierText: '1.5',
          doubletimeMultiplierText: '2',
          seventhDayDoubletimeAfterHoursText: '0',
        })
      ).toBeNull();
    });

    it('rejects a seventh-day second-tier threshold of 24 hours or more', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          seventhDayMultiplierText: '1.5',
          doubletimeMultiplierText: '2',
          seventhDayDoubletimeAfterHoursText: '24',
        })
      ).toBeNull();
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          seventhDayMultiplierText: '1.5',
          doubletimeMultiplierText: '2',
          seventhDayDoubletimeAfterHoursText: '25',
        })
      ).toBeNull();
    });
  });

  // 3-E5 / `holiday_hours_minutes` (095, §5 D-53). HOURS in the field,
  // minutes in the request — and a typed zero is refused rather than
  // silently turned into the null that already means "no credit".
  describe('the unworked-holiday credit', () => {
    it('carries the key explicitly as null when blank — never a fabricated 8h', () => {
      const result = buildCreatePayArrangementRequest(baseState);
      expect(result).toHaveProperty('holiday_hours_minutes', null);
    });

    it('converts typed hours to minutes', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          holidayHoursText: '8',
        })?.holiday_hours_minutes
      ).toBe(480);
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          holidayHoursText: '7.5',
        })?.holiday_hours_minutes
      ).toBe(450);
    });

    it('REFUSES a typed zero rather than reading it as "no credit"', () => {
      // 095's CHECK is `> 0` because null already spells "no credit". A form
      // that quietly mapped "0" onto null would be deciding which of two
      // agreements the parent meant (§2.9: refuse, never clamp).
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          holidayHoursText: '0',
        })
      ).toBeNull();
    });

    it('refuses a negative or unparsable value rather than dropping the field', () => {
      for (const text of ['-4', 'eight', '8h']) {
        expect(
          buildCreatePayArrangementRequest({
            ...baseState,
            holidayHoursText: text,
          })
        ).toBeNull();
      }
    });

    it('stands alone — setting it changes no other holiday term', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        holidayHoursText: '8',
      });
      expect(result?.worked_holiday_multiplier).toBeNull();
    });
  });

  // 3-E4 / `worked_holiday_multiplier`. Same numeric(3,2) shape as the tier
  // multipliers above and the same refuse-don't-clamp discipline — but no
  // cross-field rule at all: the premium stands alone, because whether a
  // given date IS a holiday is the household's list, not this arrangement's.
  describe('the worked-holiday premium', () => {
    it('carries the key explicitly as null when blank — never 1.5, which would invent a premium nobody agreed', () => {
      const result = buildCreatePayArrangementRequest(baseState);
      expect(result).toHaveProperty('worked_holiday_multiplier', null);
    });

    it('sends a typed multiplier, on its own, with no other tier set', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        workedHolidayMultiplierText: '1.5',
      });
      expect(result?.worked_holiday_multiplier).toBe(1.5);
      expect(result?.seventh_day_multiplier).toBeNull();
      expect(result?.doubletime_multiplier).toBeNull();
    });

    it('accepts exactly 1 — "a worked holiday pays the normal rate" is a term, not a blank', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        workedHolidayMultiplierText: '1',
      });
      expect(result?.worked_holiday_multiplier).toBe(1);
    });

    it('rejects a multiplier below 1 — a holiday premium can never pay LESS than an ordinary hour', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          workedHolidayMultiplierText: '0.5',
        })
      ).toBeNull();
    });

    it('rejects a three-decimal multiplier and one above the numeric(3,2) ceiling', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          workedHolidayMultiplierText: '1.555',
        })
      ).toBeNull();
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          workedHolidayMultiplierText: '50',
        })
      ).toBeNull();
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          workedHolidayMultiplierText: '9.99',
        })?.worked_holiday_multiplier
      ).toBe(9.99);
    });

    it('rejects an unparsable multiplier rather than dropping the field', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          workedHolidayMultiplierText: 'time and a half',
        })
      ).toBeNull();
    });
  });

  // 082 (D-17, T7 reversal). Presentation only — the field-by-field
  // three-key contract (T17) mirrors the 078/080 blocks above.
  describe('pay frequency + pay day (082)', () => {
    it('carries all three keys explicitly as null when the schedule is unset', () => {
      const result = buildCreatePayArrangementRequest(baseState);
      expect(result).toHaveProperty('pay_frequency', null);
      expect(result).toHaveProperty('pay_day_of_week', null);
      expect(result).toHaveProperty('pay_day_of_month', null);
    });

    it('sends the weekday for weekly/biweekly, day-of-month left null', () => {
      const weekly = buildCreatePayArrangementRequest({
        ...baseState,
        payFrequency: 'weekly',
        payDayOfWeekText: '5',
      });
      expect(weekly?.pay_frequency).toBe('weekly');
      expect(weekly?.pay_day_of_week).toBe(5);
      expect(weekly?.pay_day_of_month).toBeNull();

      const biweekly = buildCreatePayArrangementRequest({
        ...baseState,
        payFrequency: 'biweekly',
        payDayOfWeekText: '0',
      });
      expect(biweekly?.pay_day_of_week).toBe(0);
    });

    it('sends the day-of-month for semimonthly/monthly, weekday left null', () => {
      const semimonthly = buildCreatePayArrangementRequest({
        ...baseState,
        payFrequency: 'semimonthly',
        payDayOfMonthText: '15',
      });
      expect(semimonthly?.pay_frequency).toBe('semimonthly');
      expect(semimonthly?.pay_day_of_month).toBe(15);
      expect(semimonthly?.pay_day_of_week).toBeNull();

      const monthly = buildCreatePayArrangementRequest({
        ...baseState,
        payFrequency: 'monthly',
        payDayOfMonthText: '1',
      });
      expect(monthly?.pay_day_of_month).toBe(1);
    });

    it('a frequency with no day typed is still valid — the day is optional within a chosen frequency', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        payFrequency: 'monthly',
      });
      expect(result?.pay_frequency).toBe('monthly');
      expect(result?.pay_day_of_month).toBeNull();
    });

    it('rejects an out-of-range day-of-week', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          payFrequency: 'weekly',
          payDayOfWeekText: '7',
        })
      ).toBeNull();
    });

    it('rejects an out-of-range day-of-month', () => {
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          payFrequency: 'monthly',
          payDayOfMonthText: '32',
        })
      ).toBeNull();
      expect(
        buildCreatePayArrangementRequest({
          ...baseState,
          payFrequency: 'monthly',
          payDayOfMonthText: '0',
        })
      ).toBeNull();
    });

    it('ignores a day-of-month typed against a weekly frequency, and vice versa — only the applicable field is read', () => {
      const result = buildCreatePayArrangementRequest({
        ...baseState,
        payFrequency: 'weekly',
        payDayOfWeekText: '2',
        payDayOfMonthText: 'not a number at all',
      });
      expect(result?.pay_day_of_week).toBe(2);
      expect(result?.pay_day_of_month).toBeNull();
    });
  });

  it('rejects a weekly overtime threshold of 168 hours or more', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        overtimeThresholdHoursText: '168',
        overtimeMultiplierText: '1.5',
      })
    ).toBeNull();
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        overtimeThresholdHoursText: '169',
        overtimeMultiplierText: '1.5',
      })
    ).toBeNull();
  });

  it('rejects guaranteed hours of 168 a week or more', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        guaranteedHoursText: '168',
      })
    ).toBeNull();
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        guaranteedHoursText: '169',
      })
    ).toBeNull();
  });
});

describe('PayTermsGroups overtime caution guard', () => {
  it('checks both the low and high sides of the weekly overtime threshold', () => {
    expect(payTermsGroupsSource).toContain('threshold < 20');
    expect(payTermsGroupsSource).toContain('threshold > 40');
  });
});

describe('buildMidWeekConsequence', () => {
  it('is null when the effective date is the household’s week start (no split)', () => {
    expect(
      buildMidWeekConsequence('2026-08-03', 1, 1850, 'GBP', 1950, 'GBP')
    ).toBeNull();
  });

  // The inversion 3-E1 fixes: for a Sunday-start household the Monday warns
  // and the Sunday stays silent — the old Monday literal had it backwards,
  // warning on the one day that does NOT split their week.
  it('warns on a Monday but not a Sunday for a Sunday-start household', () => {
    expect(
      buildMidWeekConsequence('2026-08-02', 0, 1850, 'GBP', 1950, 'GBP')
    ).toBeNull();
    expect(
      buildMidWeekConsequence('2026-08-03', 0, 1850, 'GBP', 1950, 'GBP')
    ).not.toBeNull();
  });

  it('describes the two-rate split for a mid-week effective date', () => {
    const result = buildMidWeekConsequence(
      '2026-09-04',
      1,
      1850,
      'GBP',
      1950,
      'GBP'
    );
    expect(result).toEqual({
      oldRateLabel: '£18.50',
      oldUntilLabel: 'Thursday, September 3',
      newRateLabel: '£19.50',
      newFromLabel: 'Friday, September 4',
    });
  });

  it('is null when rate and currency are unchanged (pre-fill is not a split)', () => {
    expect(
      buildMidWeekConsequence('2026-08-04', 1, 1850, 'GBP', 1850, 'GBP')
    ).toBeNull();
  });
});

// 3-U1 — the "In writing" and "Outside wages" groups (spec §3/§4.3), and the
// D-7 preset stamp (§5.2).
describe('buildCreatePayArrangementRequest — the terms jsonb bag', () => {
  it('converts the UI notice-period WEEKS field into stored DAYS', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      noticePeriodWeeksText: '4',
    });
    expect(result?.terms).toEqual({ notice_period_days: 28 });
  });

  it('refuses a negative notice period', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        noticePeriodWeeksText: '-1',
      })
    ).toBeNull();
  });

  it('stores probation days as an integer, verbatim', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      probationDaysText: '90',
    });
    expect(result?.terms).toEqual({ probation_days: 90 });
  });

  it('refuses a non-integer probation length', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        probationDaysText: '90.5',
      })
    ).toBeNull();
  });

  it('stores duties/driving/live-in verbatim, trimmed, and omits an untouched field', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      dutiesText: '  Care for the kids, meals, school pickup.  ',
      drivingText: 'School run in our car.',
    });
    expect(result?.terms).toEqual({
      duties: 'Care for the kids, meals, school pickup.',
      driving: 'School run in our car.',
    });
  });

  it('a blank documentary field never lands in the stored bag', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      dutiesText: '   ',
    });
    expect(result?.terms).toEqual({});
  });

  it('stores a stipend row as recurring[] with the amount in minor units', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      stipends: [
        { label: 'Health stipend', amountText: '200.00', cadence: 'monthly' },
      ],
    });
    expect(result?.terms).toEqual({
      recurring: [
        { label: 'Health stipend', amount_minor: 20_000, cadence: 'monthly' },
      ],
    });
  });

  it('skips a fully-blank stipend row (the ghost "add a row" left untouched)', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      stipends: [{ label: '', amountText: '', cadence: 'monthly' }],
    });
    expect(result?.terms).toEqual({});
  });

  it('refuses a stipend with a label but no valid amount', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        stipends: [
          { label: 'Health stipend', amountText: '', cadence: 'monthly' },
        ],
      })
    ).toBeNull();
  });

  it('writes the preset stamp through unchanged into terms.preset (§5.2)', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      presetStamp: {
        id: 'common-defaults',
        version: 1,
        applied_at: '2026-08-11T09:00:00.000Z',
        confirmed_by: 'parent-1',
      },
    });
    expect(result?.terms?.preset).toEqual({
      id: 'common-defaults',
      version: 1,
      applied_at: '2026-08-11T09:00:00.000Z',
      confirmed_by: 'parent-1',
    });
  });

  it('every group together builds one combined terms bag', () => {
    const result = buildCreatePayArrangementRequest({
      ...baseState,
      noticePeriodWeeksText: '2',
      dutiesText: 'Care for Mia and Theo.',
      stipends: [{ label: 'Bonus', amountText: '500', cadence: 'annual' }],
    });
    expect(result?.terms).toEqual({
      notice_period_days: 14,
      duties: 'Care for Mia and Theo.',
      recurring: [{ label: 'Bonus', amount_minor: 50_000, cadence: 'annual' }],
    });
  });
});
