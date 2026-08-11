/**
 * @module domains/pay/utils/__tests__/payArrangementForm
 *
 * Case table for the pure request-building/date logic — the "careful spot"
 * TIER0-PLAN.md flags for this slice (mid-week rate split, no-future-dates,
 * the household-window-0-maps-to-no-pay rule).
 */
import { describe, expect, it } from 'bun:test';
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
  dailyOvertimeThresholdHoursText: '',
  doubletimeThresholdHoursText: '',
  doubletimeMultiplierText: '',
  seventhDayMultiplierText: '',
  seventhDayDoubletimeAfterHoursText: '',
  guaranteedHoursText: '',
  ptoHoursPerYearText: '',
  mileageRateText: '',
  cancellationChoice: 'none',
  cancellationHoursText: '',
  note: '',
};

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

describe('formatWeekdayLong / formatShortDate / formatDisplayDateWithYear', () => {
  it('formats a full weekday date', () => {
    expect(formatWeekdayLong('2026-09-03')).toBe('Thursday 3 September');
  });

  it('formats a short no-year date', () => {
    expect(formatShortDate('2026-08-04')).toBe('4 Aug');
  });

  it('formats a date with year', () => {
    expect(formatDisplayDateWithYear('2026-04-01')).toBe('1 Apr 2026');
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
      cancellation_paid_within_hours: null,
      valid_from: '2026-08-04',
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
      guaranteedHoursText: '40',
      ptoHoursPerYearText: '140',
      mileageRateText: '0.45',
      cancellationChoice: 'window',
      cancellationHoursText: '24',
      note: '  Annual review  ',
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
      guaranteed_minutes_per_week: 2400,
      pto_entitlement_minutes_per_year: 8400,
      mileage_rate_per_mile_minor: 45,
      cancellation_paid_within_hours: 24,
      valid_from: '2026-08-04',
      note: 'Annual review',
    });
  });

  it('rejects an unparsable rate', () => {
    expect(
      buildCreatePayArrangementRequest({ ...baseState, rateText: '18.999' })
    ).toBeNull();
  });

  it('rejects a future effective date — no scheduled changes in v1 (owner decision 4)', () => {
    expect(
      buildCreatePayArrangementRequest({
        ...baseState,
        effectiveDateISO: '2026-08-05',
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
      oldUntilLabel: 'Thursday 3 September',
      newRateLabel: '£19.50',
      newFromLabel: 'Friday 4 September',
    });
  });

  it('is null when rate and currency are unchanged (pre-fill is not a split)', () => {
    expect(
      buildMidWeekConsequence('2026-08-04', 1, 1850, 'GBP', 1850, 'GBP')
    ).toBeNull();
  });
});
