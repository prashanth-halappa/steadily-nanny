import { describe, expect, it } from 'bun:test';
import { computePayPeriodEnd } from '../../../../../src/domains/pay/utils/payPeriod';

function input(
  over: Partial<Parameters<typeof computePayPeriodEnd>[0]> = {}
): Parameters<typeof computePayPeriodEnd>[0] {
  return {
    weekEnd: '2026-08-09', // Sunday, closing a Mon 2026-08-03 week
    weekStart: '2026-08-03',
    payFrequency: null,
    arrangementValidFrom: '2026-01-01', // a Thursday
    weekStartsOn: 1, // Monday-start household
    payDayOfMonth: null,
    ...over,
  };
}

describe('computePayPeriodEnd — no schedule stated', () => {
  it('returns null when pay_frequency is null — never a fabricated period', () => {
    expect(computePayPeriodEnd(input())).toBeNull();
  });
});

describe('computePayPeriodEnd — weekly', () => {
  it('the period IS the week: period_end === weekEnd, always', () => {
    expect(computePayPeriodEnd(input({ payFrequency: 'weekly' }))).toBe(
      '2026-08-09'
    );
  });
});

describe('computePayPeriodEnd — biweekly', () => {
  // Anchor: 2026-01-01 (Thu) rounds down to its Monday-start week: 2025-12-29.
  it('the anchor week itself ends 13 days after its own start', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'biweekly',
          weekStart: '2025-12-29',
          weekEnd: '2026-01-04',
        })
      )
    ).toBe('2026-01-11'); // 2025-12-29 + 13
  });

  it('the SECOND week of the anchor pair shares the same period end as the first', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'biweekly',
          weekStart: '2026-01-05',
          weekEnd: '2026-01-11',
        })
      )
    ).toBe('2026-01-11');
  });

  it('the NEXT pair starts a new 14-day cycle', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'biweekly',
          weekStart: '2026-01-12',
          weekEnd: '2026-01-18',
        })
      )
    ).toBe('2026-01-25');
  });

  it('a week BEFORE the anchor still resolves via floor division, not a crash', () => {
    // One full cycle before the anchor pair.
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'biweekly',
          weekStart: '2025-12-15',
          weekEnd: '2025-12-21',
        })
      )
    ).toBe('2025-12-28'); // the pair 2025-12-15 / 2025-12-22
  });
});

describe('computePayPeriodEnd — semimonthly', () => {
  it('returns null with no day-of-month stated — never a fabricated cutoff', () => {
    expect(
      computePayPeriodEnd(input({ payFrequency: 'semimonthly' }))
    ).toBeNull();
  });

  it('a week ending ON OR BEFORE the cutoff resolves to the cutoff date', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'semimonthly',
          payDayOfMonth: 15,
          weekStart: '2026-08-03',
          weekEnd: '2026-08-09',
        })
      )
    ).toBe('2026-08-15');
  });

  it('a week SPANNING the cutoff (weekEnd past it) resolves to the calendar month end', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'semimonthly',
          payDayOfMonth: 15,
          weekStart: '2026-08-10',
          weekEnd: '2026-08-16',
        })
      )
    ).toBe('2026-08-31');
  });

  it('a week ending after the cutoff resolves to the calendar month end', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'semimonthly',
          payDayOfMonth: 15,
          weekStart: '2026-08-17',
          weekEnd: '2026-08-23',
        })
      )
    ).toBe('2026-08-31');
  });

  it('clamps a cutoff beyond the month length (e.g. 30 in February) to the actual last day', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'semimonthly',
          payDayOfMonth: 30,
          weekStart: '2026-02-16',
          weekEnd: '2026-02-22', // 2026 is not a leap year — Feb has 28 days
        })
      )
    ).toBe('2026-02-28');
  });
});

describe('computePayPeriodEnd — monthly', () => {
  it('resolves to the last calendar day of the month containing weekEnd', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'monthly',
          weekStart: '2026-08-03',
          weekEnd: '2026-08-09',
        })
      )
    ).toBe('2026-08-31');
  });

  it('handles February in a leap year correctly', () => {
    expect(
      computePayPeriodEnd(
        input({
          payFrequency: 'monthly',
          weekStart: '2026-02-16', // 2026 is not a leap year
          weekEnd: '2026-02-22',
        })
      )
    ).toBe('2026-02-28');
  });

  it('ignores pay_day_of_month entirely — the calendar month is the period regardless of when the money moves', () => {
    const withDay = computePayPeriodEnd(
      input({
        payFrequency: 'monthly',
        payDayOfMonth: 1,
        weekStart: '2026-08-03',
        weekEnd: '2026-08-09',
      })
    );
    const withoutDay = computePayPeriodEnd(
      input({
        payFrequency: 'monthly',
        payDayOfMonth: null,
        weekStart: '2026-08-03',
        weekEnd: '2026-08-09',
      })
    );
    expect(withDay).toBe(withoutDay);
    expect(withDay).toBe('2026-08-31');
  });
});
