/**
 * @module domains/pay/utils/__tests__/termRows
 *
 * Case table for the six fixed-order rows (TIER0-CX-SPEC.md §2). Uses a
 * real interpolating fake `t` (not the global key-echo mock, which drops
 * params) so the actual copy shape is checked, not just the key.
 */
import { describe, expect, it } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { buildTermRows } from '../termRows';

function fakeT(key: string, params?: Record<string, unknown>): string {
  const templates: Record<string, string> = {
    'terms.overtimeLabel': 'Overtime',
    'terms.overtimeValue': `After ${params?.hours}h, at ${params?.multiplier}×`,
    'terms.dailyOvertimeLabel': 'Daily overtime',
    'terms.dailyOvertimeValue': `After ${params?.hours}h in a day, at ${params?.multiplier}×`,
    'terms.doubletimeLabel': 'Double time',
    'terms.doubletimeValue': `After ${params?.hours}h in a day, at ${params?.multiplier}×`,
    'terms.seventhDayLabel': 'Seventh consecutive day',
    'terms.seventhDayValue': `At ${params?.multiplier}×`,
    'terms.seventhDayTwoTierValue': `At ${params?.multiplier}×, then ${params?.doubleMultiplier}× after ${params?.hours}h`,
    'terms.guaranteedHoursLabel': 'Guaranteed hours',
    'terms.guaranteedHoursValue': `${params?.hours}h a week`,
    'terms.ptoLabel': 'Paid time off',
    'terms.ptoValue': `${params?.hours}h a year`,
    'terms.cancellationsLabel': 'Cancellations',
    'terms.cancellationsValue': `Paid if within ${params?.hours}h of the start`,
    'terms.mileageLabel': 'Mileage',
    'terms.mileageValue': `${params?.amount} a mile`,
    'terms.ptoBalanceLabel': 'PTO balance',
    'terms.ptoBalanceValue': `${params?.amount} left this year`,
    'terms.ptoBalanceCaption': `1 Jan – 31 Dec ${params?.year}`,
    noCancellationPay: 'No cancellation pay',
  };
  return templates[key] ?? key;
}

const fullArrangement: PayArrangement = {
  id: 'arr-1',
  household_id: 'hh-1',
  carer_id: 'carer-1',
  rate_minor: 1850,
  bill_rate_minor: null,
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
  valid_from: '2026-04-01',
  // 065: null = still live; set only when a member is removed.
  valid_to: null,
  carer_display_name: 'Priya',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-03-28T09:00:00.000Z',
};

const emptyArrangement: PayArrangement = {
  ...fullArrangement,
  overtime_threshold_minutes: null,
  overtime_daily_threshold_minutes: null,
  doubletime_daily_threshold_minutes: null,
  doubletime_multiplier: null,
  seventh_day_multiplier: null,
  seventh_day_doubletime_after_minutes: null,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
};

describe('buildTermRows', () => {
  it('returns exactly nine rows, in the spec order — the three 078 tiers sit between weekly overtime and guaranteed hours', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    expect(rows.map(r => r.key)).toEqual([
      'overtime',
      'dailyOvertime',
      'doubletime',
      'seventhDay',
      'guaranteedHours',
      'pto',
      'cancellations',
      'mileage',
      'ptoBalance',
    ]);
  });

  it('formats every set term', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
    expect(byKey.overtime).toBe('After 40h, at 1.5×');
    expect(byKey.guaranteedHours).toBe('40h a week');
    expect(byKey.pto).toBe('140h a year');
    expect(byKey.cancellations).toBe('Paid if within 24h of the start');
    expect(byKey.mileage).toBe('£0.45 a mile');
  });

  // 3-E2: the daily tier reuses `overtime_multiplier` — it deliberately has
  // no multiplier column of its own, so the row must read the weekly one.
  it('the daily overtime row reuses the weekly overtime multiplier', () => {
    const rows = buildTermRows(
      { ...fullArrangement, overtime_multiplier: 1.75 },
      fakeT as never
    );
    expect(rows.find(r => r.key === 'dailyOvertime')?.value).toBe(
      'After 8h in a day, at 1.75×'
    );
  });

  it('the double-time row uses its own shared multiplier', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    expect(rows.find(r => r.key === 'doubletime')?.value).toBe(
      'After 12h in a day, at 2×'
    );
  });

  it('a two-tier seventh day states both rates and where the second starts', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    expect(rows.find(r => r.key === 'seventhDay')?.value).toBe(
      'At 1.5×, then 2× after 8h'
    );
  });

  it('a single-tier seventh day states one rate and no second tier', () => {
    const rows = buildTermRows(
      { ...fullArrangement, seventh_day_doubletime_after_minutes: null },
      fakeT as never
    );
    expect(rows.find(r => r.key === 'seventhDay')?.value).toBe('At 1.5×');
  });

  // A pre-078 row carries no such column at all. It must read as "no tier",
  // never as a crash and never as a fabricated 1.5×.
  it('an arrangement predating 078 (columns absent, not just null) reads as no tier', () => {
    const preMigration: PayArrangement = {
      ...fullArrangement,
      overtime_daily_threshold_minutes: undefined,
      doubletime_daily_threshold_minutes: undefined,
      doubletime_multiplier: undefined,
      seventh_day_multiplier: undefined,
      seventh_day_doubletime_after_minutes: undefined,
    };
    const byKey = Object.fromEntries(
      buildTermRows(preMigration, fakeT as never).map(r => [r.key, r.value])
    );
    expect(byKey.dailyOvertime).toBeNull();
    expect(byKey.doubletime).toBeNull();
    expect(byKey.seventhDay).toBeNull();
  });

  it('a null term renders null value (caller applies "Not set")', () => {
    const rows = buildTermRows(emptyArrangement, fakeT as never);
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
    expect(byKey.overtime).toBeNull();
    expect(byKey.dailyOvertime).toBeNull();
    expect(byKey.doubletime).toBeNull();
    expect(byKey.seventhDay).toBeNull();
    expect(byKey.guaranteedHours).toBeNull();
    expect(byKey.pto).toBeNull();
    expect(byKey.mileage).toBeNull();
  });

  it('null cancellations gets its own override — "No cancellation pay", never "Not set"', () => {
    const rows = buildTermRows(emptyArrangement, fakeT as never);
    const cancellations = rows.find(r => r.key === 'cancellations');
    expect(cancellations?.value).toBeNull();
    expect(cancellations?.valueWhenNull).toBe('No cancellation pay');
  });

  it('no entitlement set: the PTO balance row reads "Not set" — an agreement, not a gap', () => {
    const rows = buildTermRows(emptyArrangement, fakeT as never, {
      carer_id: 'carer-1',
      household_id: 'hh-1',
      year: 2026,
      entitlement_minutes: null,
      accrued_minutes: 0,
      used_minutes: 0,
      balance_minutes: 0,
    });
    const ptoBalance = rows.find(r => r.key === 'ptoBalance');
    expect(ptoBalance?.value).toBeNull();
    expect(ptoBalance?.valueWhenNull).toBeUndefined();
    expect(ptoBalance?.subLine).toBeUndefined();
  });

  it('balance still loading (undefined): the row is blank, never "Not set" and never "0h"', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never, undefined);
    const ptoBalance = rows.find(r => r.key === 'ptoBalance');
    expect(ptoBalance?.value).toBe('');
    expect(ptoBalance?.subLine).toBeUndefined();
  });

  it('balance ready: renders the hours-left figure plus the "1 Jan – 31 Dec" caption', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never, {
      carer_id: 'carer-1',
      household_id: 'hh-1',
      year: 2026,
      entitlement_minutes: 8400,
      accrued_minutes: 8400,
      used_minutes: 2880,
      balance_minutes: 5520,
    });
    const ptoBalance = rows.find(r => r.key === 'ptoBalance');
    expect(ptoBalance?.value).toBe('92h left this year');
    expect(ptoBalance?.subLine).toBe('1 Jan – 31 Dec 2026');
  });

  it('a NEGATIVE balance renders honestly, with a leading minus — never clamped to zero', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never, {
      carer_id: 'carer-1',
      household_id: 'hh-1',
      year: 2026,
      entitlement_minutes: 8400,
      accrued_minutes: 8400,
      used_minutes: 9000,
      balance_minutes: -600,
    });
    const ptoBalance = rows.find(r => r.key === 'ptoBalance');
    expect(ptoBalance?.value).toBe('-10h left this year');
  });

  it('entitlement is set but the API reports no balance record: still "Not set", not a crash', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never, null);
    const ptoBalance = rows.find(r => r.key === 'ptoBalance');
    expect(ptoBalance?.value).toBeNull();
  });
});
