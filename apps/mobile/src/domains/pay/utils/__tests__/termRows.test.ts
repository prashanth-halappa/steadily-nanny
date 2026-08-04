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
    'terms.guaranteedHoursLabel': 'Guaranteed hours',
    'terms.guaranteedHoursValue': `${params?.hours}h a week`,
    'terms.ptoLabel': 'Paid time off',
    'terms.ptoValue': `${params?.hours}h a year`,
    'terms.cancellationsLabel': 'Cancellations',
    'terms.cancellationsValue': `Paid if within ${params?.hours}h of the start`,
    'terms.mileageLabel': 'Mileage',
    'terms.mileageValue': `${params?.amount} a mile`,
    'terms.ptoBalanceLabel': 'PTO balance',
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
  guaranteed_minutes_per_week: 2400,
  pto_entitlement_minutes_per_year: 8400,
  mileage_rate_per_mile_minor: 45,
  cancellation_paid_within_hours: 24,
  valid_from: '2026-04-01',
  carer_display_name: 'Priya',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-03-28T09:00:00.000Z',
};

const emptyArrangement: PayArrangement = {
  ...fullArrangement,
  overtime_threshold_minutes: null,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
};

describe('buildTermRows', () => {
  it('returns exactly six rows, in the spec order', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    expect(rows.map(r => r.key)).toEqual([
      'overtime',
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

  it('a null term renders null value (caller applies "Not set")', () => {
    const rows = buildTermRows(emptyArrangement, fakeT as never);
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
    expect(byKey.overtime).toBeNull();
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

  it('the PTO balance row is always "Not set" in Phase 1 — no ledger to read yet', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    const ptoBalance = rows.find(r => r.key === 'ptoBalance');
    expect(ptoBalance?.value).toBeNull();
    expect(ptoBalance?.valueWhenNull).toBeUndefined();
  });
});
