/**
 * `payPeriod.ts` moved here from `apps/api/src/domains/pay/utils/` so the app
 * can derive the same period end the export row states — one implementation,
 * not two that drift. The pre-existing period-end cases stay pinned in
 * `apps/api/tests/unit/domains/pay/utils/payPeriod.test.ts`, which now also
 * proves the old import path still resolves; this file pins the DUE DATE
 * layer built on top of it.
 */
import { describe, expect, it } from 'bun:test';
import { computePayDueDate, computePayPeriodEnd } from '../src/payPeriod';

function input(
  over: Partial<Parameters<typeof computePayDueDate>[0]> = {}
): Parameters<typeof computePayDueDate>[0] {
  return {
    weekEnd: '2026-08-09', // Sunday, closing a Mon 2026-08-03 week
    weekStart: '2026-08-03',
    payFrequency: null,
    arrangementValidFrom: '2026-01-01', // a Thursday
    weekStartsOn: 1, // Monday-start household
    payDayOfMonth: null,
    payDayOfWeek: null,
    ...over,
  };
}

describe('computePayPeriodEnd — still exported from shared-types', () => {
  it('returns the week itself for a weekly schedule', () => {
    expect(computePayPeriodEnd(input({ payFrequency: 'weekly' }))).toBe(
      '2026-08-09'
    );
  });

  it('returns null when no schedule is stated', () => {
    expect(computePayPeriodEnd(input())).toBeNull();
  });
});

describe('computePayDueDate — nothing to derive', () => {
  it('is null with no pay_frequency — a due date is never invented', () => {
    expect(computePayDueDate(input())).toBeNull();
  });

  it('is null for semimonthly with no day-of-month, exactly as the period end is', () => {
    expect(
      computePayDueDate(input({ payFrequency: 'semimonthly' }))
    ).toBeNull();
  });
});

describe('computePayDueDate — weekly', () => {
  it('falls on the stated pay day AFTER the week it closes — Friday pay for a Sun-ending week', () => {
    // 2026-08-09 is a Sunday; the next Friday (dow 5) is 2026-08-14.
    expect(
      computePayDueDate(input({ payFrequency: 'weekly', payDayOfWeek: 5 }))
    ).toBe('2026-08-14');
  });

  it('rolls to NEXT week when the pay day falls earlier in the week than the period end', () => {
    // Period ends Sunday 2026-08-09; pay day Wednesday (dow 3) has already
    // passed that week, so the next one is 2026-08-12.
    expect(
      computePayDueDate(input({ payFrequency: 'weekly', payDayOfWeek: 3 }))
    ).toBe('2026-08-12');
  });

  it('is the period end itself when the pay day IS the period end weekday', () => {
    // 2026-08-09 is a Sunday (dow 0) — on or after, so no advance at all.
    expect(
      computePayDueDate(input({ payFrequency: 'weekly', payDayOfWeek: 0 }))
    ).toBe('2026-08-09');
  });

  it('falls back to the period end when no pay day of week is stated', () => {
    expect(computePayDueDate(input({ payFrequency: 'weekly' }))).toBe(
      '2026-08-09'
    );
  });
});

describe('computePayDueDate — biweekly', () => {
  it('advances from the PAIR end, not this week end', () => {
    // Anchor 2026-01-01 rounds to Mon 2025-12-29; the pair containing the
    // week of 2026-01-05 ends 2026-01-11 (a Sunday). Friday after: 01-16.
    expect(
      computePayDueDate(
        input({
          payFrequency: 'biweekly',
          weekStart: '2026-01-05',
          weekEnd: '2026-01-11',
          payDayOfWeek: 5,
        })
      )
    ).toBe('2026-01-16');
  });

  it('gives the first week of a pair the same due date as the second', () => {
    const first = computePayDueDate(
      input({
        payFrequency: 'biweekly',
        weekStart: '2025-12-29',
        weekEnd: '2026-01-04',
        payDayOfWeek: 5,
      })
    );
    expect(first).toBe('2026-01-16');
  });
});

describe('computePayDueDate — semimonthly and monthly', () => {
  it('is the semimonthly cutoff itself — pay_day_of_week is not read', () => {
    expect(
      computePayDueDate(
        input({
          payFrequency: 'semimonthly',
          payDayOfMonth: 15,
          payDayOfWeek: 5,
        })
      )
    ).toBe('2026-08-15');
  });

  it('is the calendar month end for monthly', () => {
    expect(
      computePayDueDate(input({ payFrequency: 'monthly', payDayOfWeek: 5 }))
    ).toBe('2026-08-31');
  });
});
