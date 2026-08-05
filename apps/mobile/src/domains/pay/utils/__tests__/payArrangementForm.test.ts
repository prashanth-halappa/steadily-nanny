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
  isMonday,
  isValidCalendarDate,
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

describe('isMonday', () => {
  it('2026-08-03 is a Monday', () => {
    expect(isMonday('2026-08-03')).toBe(true);
  });

  it('2026-08-04 (Tuesday) is not', () => {
    expect(isMonday('2026-08-04')).toBe(false);
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
});

describe('buildMidWeekConsequence', () => {
  it('is null when the effective date is a Monday (no split)', () => {
    expect(
      buildMidWeekConsequence('2026-08-03', 1850, 'GBP', 1950, 'GBP')
    ).toBeNull();
  });

  it('describes the two-rate split for a non-Monday effective date', () => {
    const result = buildMidWeekConsequence(
      '2026-09-04',
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
      buildMidWeekConsequence('2026-08-04', 1850, 'GBP', 1850, 'GBP')
    ).toBeNull();
  });
});
