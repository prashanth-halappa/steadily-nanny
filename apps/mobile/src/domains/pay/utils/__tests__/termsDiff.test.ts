/**
 * @module domains/pay/utils/__tests__/termsDiff
 *
 * §7's diff-first change and §8.5's version history share `buildTermsDiff`;
 * §7.3's T11 consequence sentences are `buildTermsChangeConsequence`.
 */
import { describe, expect, it } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { buildTermsChangeConsequence, buildTermsDiff } from '../termsDiff';

function fakeT(key: string, params?: Record<string, unknown>): string {
  const templates: Record<string, string> = {
    'terms.overtimeLabel': 'Overtime',
    'terms.overtimeValue': `After ${params?.hours}h, at ${params?.multiplier}×`,
    'terms.guaranteedHoursLabel': 'Guaranteed hours',
    'terms.guaranteedHoursValue': `${params?.hours}h a week`,
    'terms.cancellationsLabel': 'Cancellations',
    'terms.cancellationsValue': `Paid if within ${params?.hours}h of the start`,
    'terms.mileageLabel': 'Mileage',
    'terms.mileageValue': `${params?.amount} a mile`,
    'terms.ptoLabel': 'Paid time off',
    'terms.ptoValue': `${params?.hours}h a year`,
    'history.notSet': 'Not set',
    noCancellationPay: 'No cancellation pay',
  };
  return templates[key] ?? key;
}

function arrangement(over: Partial<PayArrangement> = {}): PayArrangement {
  return {
    id: 'arr-1',
    household_id: 'hh-1',
    carer_id: 'carer-1',
    rate_minor: 1850,
    bill_rate_minor: null,
    currency: 'GBP',
    overtime_threshold_minutes: null,
    overtime_multiplier: 1.5,
    guaranteed_minutes_per_week: null,
    pto_entitlement_minutes_per_year: null,
    mileage_rate_per_mile_minor: null,
    cancellation_paid_within_hours: null,
    valid_from: '2026-04-01',
    valid_to: null,
    carer_display_name: 'Nia Rowe',
    note: null,
    created_by: 'parent-1',
    created_at: '2026-04-01T09:00:00.000Z',
    ...over,
  };
}

describe('buildTermsDiff', () => {
  it('reports the rate change when it changed', () => {
    const rows = buildTermsDiff(
      arrangement({ rate_minor: 1850 }),
      arrangement({ rate_minor: 2000 }),
      fakeT
    );
    const rateRow = rows.find(r => r.key === 'rate');
    expect(rateRow).toEqual({
      key: 'rate',
      label: 'history.diffRateLabel',
      before: '£18.50',
      after: '£20.00',
    });
  });

  it('omits the rate row when unchanged', () => {
    const rows = buildTermsDiff(
      arrangement({ rate_minor: 1850 }),
      arrangement({ rate_minor: 1850 }),
      fakeT
    );
    expect(rows.find(r => r.key === 'rate')).toBeUndefined();
  });

  // §7.1: "A term going from unset to set reads 'Not set → After 8h, at
  // 1.5×'" — `before: null` is reserved for "there was no PREVIOUS
  // ARRANGEMENT at all" (the next test), not "this term was unset on it".
  it('a term newly set (was unset on a real previous arrangement) reads "Not set" → the formatted value', () => {
    const rows = buildTermsDiff(
      arrangement({ guaranteed_minutes_per_week: null }),
      arrangement({ guaranteed_minutes_per_week: 3000 }),
      fakeT
    );
    const row = rows.find(r => r.key === 'guaranteedHours');
    expect(row).toEqual({
      key: 'guaranteedHours',
      label: 'Guaranteed hours',
      before: 'Not set',
      after: '50h a week',
    });
  });

  it('a term cleared reads before=the old value, after="Not set" — never "$0.00" (T16)', () => {
    const rows = buildTermsDiff(
      arrangement({ guaranteed_minutes_per_week: 2400 }),
      arrangement({ guaranteed_minutes_per_week: null }),
      fakeT
    );
    const row = rows.find(r => r.key === 'guaranteedHours');
    expect(row?.after).toBe('Not set');
    expect(row?.before).toBe('40h a week');
  });

  it('an unchanged, still-unset term produces no row at all', () => {
    const rows = buildTermsDiff(
      arrangement({ mileage_rate_per_mile_minor: null }),
      arrangement({ mileage_rate_per_mile_minor: null }),
      fakeT
    );
    expect(rows.find(r => r.key === 'mileage')).toBeUndefined();
  });

  it('null previous (the FIRST arrangement) reports every set term with before=null', () => {
    const rows = buildTermsDiff(
      null,
      arrangement({ rate_minor: 1850, cancellation_paid_within_hours: 24 }),
      fakeT
    );
    const cancellationsRow = rows.find(r => r.key === 'cancellations');
    expect(cancellationsRow?.before).toBeNull();
    const rateRow = rows.find(r => r.key === 'rate');
    expect(rateRow?.before).toBeNull();
    expect(rateRow?.after).toBe('£18.50');
  });

  it('never includes the live PTO-balance row — it is a read, not a term', () => {
    const rows = buildTermsDiff(
      arrangement({ pto_entitlement_minutes_per_year: 8400 }),
      arrangement({ pto_entitlement_minutes_per_year: 16800 }),
      fakeT
    );
    expect(rows.find(r => r.key === 'ptoBalance')).toBeUndefined();
  });
});

describe('buildTermsChangeConsequence (T11 — every term, not just rate)', () => {
  const rateDiff = [
    { key: 'rate', label: 'x', before: '£18.50', after: '£20.00' },
  ];
  const cancellationDiff = [
    { key: 'cancellations', label: 'x', before: null, after: 'x' },
  ];

  it('fires nothing when the change lands exactly on the week start', () => {
    expect(buildTermsChangeConsequence(rateDiff, true)).toEqual([]);
  });

  it('fires nothing when nothing changed', () => {
    expect(buildTermsChangeConsequence([], false)).toEqual([]);
  });

  it('a rate change gets the rate consequence, plus the trailing check-the-week sentence', () => {
    const result = buildTermsChangeConsequence(rateDiff, false);
    expect(result).toEqual([
      { key: 'consequence.rate' },
      { key: 'consequence.checkTheWeek' },
    ]);
  });

  // T11's actual gap: a term OTHER than the rate also warns now.
  it('a cancellations-only change fires ITS OWN consequence — not silent (the T11 gap)', () => {
    const result = buildTermsChangeConsequence(cancellationDiff, false);
    expect(result).toEqual([
      { key: 'consequence.cancellations' },
      { key: 'consequence.checkTheWeek' },
    ]);
  });

  it('multiple changed terms stack multiple consequence sentences', () => {
    const diff = [
      { key: 'rate', label: 'x', before: 'a', after: 'b' },
      { key: 'mileage', label: 'x', before: 'a', after: 'b' },
    ];
    const result = buildTermsChangeConsequence(diff, false);
    expect(result).toEqual([
      { key: 'consequence.rate' },
      { key: 'consequence.mileage' },
      { key: 'consequence.checkTheWeek' },
    ]);
  });

  it('outside-wages-only changes get no consequence line at all (spec §7.3 table)', () => {
    const diff = [{ key: 'stipends', label: 'x', before: null, after: 'x' }];
    expect(buildTermsChangeConsequence(diff, false)).toEqual([]);
  });
});
