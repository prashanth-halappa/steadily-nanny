/**
 * @module domains/timesheet/__tests__/earningsFormat.test
 * Pure formatting — the breakdown sheet's row/date copy (docs/TIER0-CX-SPEC.md §4.2).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import i18n from '@/src/i18n';
import type { EarningsLine, WeekEarningsOk } from '../types';
import {
  earningsStructureLine,
  formatEarningsDuration,
  formatEarningsLongDate,
  formatEarningsMultiplier,
  formatEarningsSpanDate,
} from '../utils/earningsFormat';

function line(overrides: Partial<EarningsLine> = {}): EarningsLine {
  return {
    kind: 'regular',
    minutes: 0,
    rate_minor: 2800,
    multiplier: null,
    amount_minor: 0,
    from_date: '2026-08-03',
    to_date: '2026-08-09',
    arrangement_id: 'arr-1',
    ...overrides,
  };
}

function okEarnings(lines: EarningsLine[]): WeekEarningsOk {
  return {
    status: 'ok',
    week_start: '2026-08-03',
    currency: 'USD',
    lines,
    gross_minor: 0,
    reimbursements_minor: 0,
    worked_minutes: 0,
    payable_minutes: 0,
    guaranteed_minutes_per_week: null,
  };
}

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

// docs/design/screens-pay-terms.md §11.1 — the collapsed one-liner. Derived
// ONLY from earnings.lines, the same lines the breakdown sheet renders — no
// second computation (D-4).
describe('earningsStructureLine (§11.1)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it("pins the spec's 53h worked example: 40 reg + 12 OT + 1 DT", () => {
    const earnings = okEarnings([
      line({ kind: 'regular', minutes: 2400 }), // 40h
      line({ kind: 'overtime', minutes: 720, multiplier: 1.5 }), // 12h
      line({ kind: 'doubletime', minutes: 60, multiplier: 2 }), // 1h
    ]);
    expect(earningsStructureLine(earnings)).toBe('53h = 40 reg + 12 OT + 1 DT');
  });

  it('omits a kind with zero priced minutes', () => {
    const earnings = okEarnings([
      line({ kind: 'regular', minutes: 2400 }),
      line({ kind: 'overtime', minutes: 0 }),
    ]);
    expect(earningsStructureLine(earnings)).toBe('40h = 40 reg');
  });

  it('never includes reimbursements — same denylist as the breakdown sheet', () => {
    const earnings = okEarnings([
      line({ kind: 'regular', minutes: 2400 }),
      line({ kind: 'reimbursements', minutes: 0, amount_minor: 500 }),
    ]);
    expect(earningsStructureLine(earnings)).toBe('40h = 40 reg');
  });

  it('is always producible — an unfamiliar kind gets a humanized label, never null', () => {
    const earnings = okEarnings([
      line({ kind: 'regular', minutes: 2400 }),
      line({ kind: 'sabbatical_credit', minutes: 60 }),
    ]);
    expect(earningsStructureLine(earnings)).toBe(
      '41h = 40 reg + 1 Sabbatical credit'
    );
  });

  it('returns null for a week with no priced minutes at all', () => {
    expect(earningsStructureLine(okEarnings([]))).toBeNull();
  });

  it('translates the short kind labels in Spanish', async () => {
    await i18n.changeLanguage('es');
    const earnings = okEarnings([
      line({ kind: 'regular', minutes: 2400 }),
      line({ kind: 'overtime', minutes: 720, multiplier: 1.5 }),
    ]);
    expect(earningsStructureLine(earnings)).toBe('52h = 40 reg + 12 extra');
  });
});
