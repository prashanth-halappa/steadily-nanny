/**
 * @module domains/timesheet/__tests__/earningsFormat.test
 * Pure formatting — the breakdown sheet's row/date copy (docs/TIER0-CX-SPEC.md §4.2).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import i18n from '@/src/i18n';
import {
  formatEarningsDuration,
  formatEarningsLongDate,
  formatEarningsMultiplier,
  formatEarningsSpanDate,
} from '../utils/earningsFormat';

describe('formatEarningsDuration', () => {
  it('zero-pads minutes on an exact-hour figure, unlike formatDuration', () => {
    expect(formatEarningsDuration(2280)).toBe('38h 00m'); // 38h exactly
  });

  it('formats a mixed hours+minutes figure', () => {
    expect(formatEarningsDuration(180)).toBe('3h 00m');
    expect(formatEarningsDuration(720)).toBe('12h 00m');
  });

  it('formats zero as 0h 00m', () => {
    expect(formatEarningsDuration(0)).toBe('0h 00m');
  });

  it('clamps a negative duration defensively', () => {
    expect(formatEarningsDuration(-5)).toBe('0h 00m');
  });
});

describe('formatEarningsSpanDate', () => {
  it('formats weekday + day + short month, matching the spec\'s "Wed 3 Sep" example', () => {
    // 2026-09-03 is a Thursday in reality, so pick a date that IS a
    // Wednesday to pin the weekday computation honestly.
    expect(formatEarningsSpanDate('2026-09-02')).toBe('Wed 2 Sep');
  });

  it('formats the spec\'s "Thu 4 Sep" example', () => {
    expect(formatEarningsSpanDate('2026-09-03')).toBe('Thu 3 Sep');
  });

  // review finding 5b: weekday/month names were hardcoded English arrays, so
  // a Spanish user read English weekday/month abbreviations inside an
  // otherwise-translated breakdown sheet. Real i18n instance + real Spanish
  // ICU data, not the component-level key-echo mock.
  describe('i18n (review finding 5b)', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('localises the weekday and month for Spanish', async () => {
      await i18n.changeLanguage('es');
      expect(formatEarningsSpanDate('2026-09-02')).toBe('mié 2 sept');
    });
  });
});

describe('formatEarningsLongDate', () => {
  it('formats day + full month, no year', () => {
    expect(formatEarningsLongDate('2026-08-10')).toBe('10 August');
  });

  // review finding 5b, cont. — this is the exact function that feeds the
  // breakdown subheader ("Approved 10 August"), the finding's own example.
  describe('i18n (review finding 5b)', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('localises the month name for Spanish', async () => {
      await i18n.changeLanguage('es');
      expect(formatEarningsLongDate('2026-08-10')).toBe('10 agosto');
    });
  });
});

describe('formatEarningsMultiplier (review finding 9a)', () => {
  // The overtime subline interpolated the raw multiplier number, so Spanish
  // read "1.5×" (period decimal) instead of the locale-correct "1,5×".
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('formats with a period decimal in English', () => {
    expect(formatEarningsMultiplier(1.5)).toBe('1.5');
  });

  it('formats with a comma decimal in Spanish', async () => {
    await i18n.changeLanguage('es');
    expect(formatEarningsMultiplier(1.5)).toBe('1,5');
  });
});
