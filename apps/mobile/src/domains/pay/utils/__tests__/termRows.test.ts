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
    'terms.workedHolidayPremiumLabel': 'Worked-holiday premium',
    'terms.workedHolidayPremiumValue': `${params?.multiplier}× when worked`,
    'terms.paidHolidayHoursLabel': 'Unworked holidays',
    'terms.paidHolidayHoursValue': `${params?.hours}h paid`,
    'terms.guaranteedHoursLabel': 'Guaranteed hours',
    'terms.guaranteedHoursValue': `${params?.hours}h a week`,
    'terms.ptoLabel': 'Paid time off',
    'terms.ptoValue': `${params?.hours}h a year`,
    'terms.cancellationsLabel': 'Cancellations',
    'terms.cancellationsValue': `Paid if within ${params?.hours}h of the start`,
    'terms.mileageLabel': 'Mileage',
    'terms.mileageValue': `${params?.amount} a mile`,
    'terms.payScheduleLabel': 'Pay schedule',
    'terms.payScheduleValueWeekly': 'Weekly',
    'terms.payScheduleValueBiweekly': 'Every two weeks',
    'terms.payScheduleValueSemimonthly': 'Twice a month',
    'terms.payScheduleValueMonthly': 'Monthly',
    'terms.outsideWagesLabel': 'Outside wages',
    'terms.outsideWagesItemWeekly': `${params?.label} ${params?.amount} a week`,
    'terms.outsideWagesItemMonthly': `${params?.label} ${params?.amount} a month`,
    'terms.outsideWagesItemAnnual': `${params?.label} ${params?.amount} a year`,
    'terms.inWritingLabel': 'In writing',
    'terms.inWritingNotice': `Notice period ${params?.weeks} weeks`,
    'terms.inWritingProbation': `Probation ${params?.days} days`,
    'terms.inWritingDuties': `What the job covers: ${params?.text}`,
    'terms.inWritingDriving': `Driving: ${params?.text}`,
    'terms.inWritingLiveIn': `Live-in: ${params?.text}`,
    'inWriting.summary': `${params?.filled} of ${params?.total} filled in`,
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
  worked_holiday_multiplier: 1.5,
  guaranteed_minutes_per_week: 2400,
  pto_entitlement_minutes_per_year: 8400,
  mileage_rate_per_mile_minor: 45,
  pay_frequency: 'biweekly',
  pay_day_of_week: 5,
  pay_day_of_month: null,
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
  worked_holiday_multiplier: null,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  pay_frequency: null,
  pay_day_of_week: null,
  pay_day_of_month: null,
  cancellation_paid_within_hours: null,
};

describe('buildTermRows', () => {
  it('returns the WHOLE §3 inventory, in the spec order — a subset is how a parent agrees to terms he was never shown (3-O §7.2)', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    expect(rows.map(r => r.key)).toEqual([
      'overtime',
      'dailyOvertime',
      'doubletime',
      'seventhDay',
      'guaranteedHours',
      'pto',
      'workedHolidayPremium',
      'paidHolidayHours',
      'cancellations',
      'mileage',
      'paySchedule',
      'outsideWages',
      'inWriting',
      'ptoBalance',
    ]);
  });

  // 3-O §7.2: the review screen renders THIS list, so a term that lives only
  // in the `terms` jsonb — a stipend, a notice period — has to be in it.
  describe('the documentary terms bag (3-O §7.2)', () => {
    it('lists every recurring stipend with its cadence in words', () => {
      const rows = buildTermRows(
        {
          ...fullArrangement,
          terms: {
            recurring: [
              {
                label: 'Health stipend',
                amount_minor: 20000,
                cadence: 'monthly',
              },
              { label: 'Phone', amount_minor: 2500, cadence: 'weekly' },
            ],
          },
        },
        fakeT as never
      );
      expect(rows.find(r => r.key === 'outsideWages')?.value).toBe(
        'Health stipend £200.00 a month · Phone £25.00 a week'
      );
    });

    it('counts the "In writing" fields and spells each one out underneath', () => {
      const row = buildTermRows(
        {
          ...fullArrangement,
          terms: {
            notice_period_days: 28,
            probation_days: 90,
            duties: 'Care for Mia and Theo',
            driving: 'School run in our car',
          },
        },
        fakeT as never
      ).find(r => r.key === 'inWriting');
      expect(row?.value).toBe('4 of 5 filled in');
      expect(row?.subLine).toBe(
        [
          'Notice period 4 weeks',
          'Probation 90 days',
          'What the job covers: Care for Mia and Theo',
          'Driving: School run in our car',
        ].join('\n')
      );
    });

    it('an empty bag is null on both rows — "Not set", never a fabricated 0', () => {
      const rows = buildTermRows(
        { ...fullArrangement, terms: {} },
        fakeT as never
      );
      expect(rows.find(r => r.key === 'outsideWages')?.value).toBeNull();
      expect(rows.find(r => r.key === 'inWriting')?.value).toBeNull();
      expect(rows.find(r => r.key === 'inWriting')?.subLine).toBeUndefined();
    });

    it('ignores a hand-edited row of the wrong shape rather than coercing it', () => {
      const rows = buildTermRows(
        {
          ...fullArrangement,
          terms: {
            recurring: [
              {
                label: 'Health stipend',
                amount_minor: 20000,
                cadence: 'monthly',
              },
              { label: 42, amount_minor: 'lots', cadence: 'monthly' },
            ],
            notice_period_days: 'four weeks',
          },
        },
        fakeT as never
      );
      expect(rows.find(r => r.key === 'outsideWages')?.value).toBe(
        'Health stipend £200.00 a month'
      );
      expect(rows.find(r => r.key === 'inWriting')?.value).toBeNull();
    });
  });

  it('formats every set term', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
    expect(byKey.overtime).toBe('After 40h, at 1.5×');
    expect(byKey.guaranteedHours).toBe('40h a week');
    expect(byKey.pto).toBe('140h a year');
    expect(byKey.cancellations).toBe('Paid if within 24h of the start');
    expect(byKey.mileage).toBe('£0.45 a mile');
    expect(byKey.paySchedule).toBe('Every two weeks');
  });

  it('pay schedule is null when unset, and formats each frequency + day', () => {
    const unset = buildTermRows(emptyArrangement, fakeT as never);
    expect(unset.find(r => r.key === 'paySchedule')?.value).toBeNull();

    const monthly = buildTermRows(
      {
        ...fullArrangement,
        pay_frequency: 'monthly',
        pay_day_of_week: null,
        pay_day_of_month: 15,
      },
      fakeT as never
    );
    expect(monthly.find(r => r.key === 'paySchedule')?.value).toBe('Monthly');
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

  // 3-E4: the premium row is the ARRANGEMENT's half of the holidays group —
  // which dates are paid is the household's list, and belongs to 3-U1.
  it('the worked-holiday premium row states the agreed multiplier', () => {
    const rows = buildTermRows(fullArrangement, fakeT as never);
    expect(rows.find(r => r.key === 'workedHolidayPremium')?.value).toBe(
      '1.5× when worked'
    );
  });

  it('a null premium reads as not-set — never a fabricated 1.5×', () => {
    const rows = buildTermRows(
      { ...fullArrangement, worked_holiday_multiplier: null },
      fakeT as never
    );
    expect(rows.find(r => r.key === 'workedHolidayPremium')?.value).toBeNull();
  });

  // 3-E5: the holidays group's other half — what an observed holiday NOBODY
  // WORKED credits (§5 D-53). Its own row beside the premium, because the two
  // answer different days and a family may agree either, both or neither.
  it('the unworked-holiday row states the agreed hours', () => {
    const rows = buildTermRows(
      { ...fullArrangement, holiday_hours_minutes: 480 },
      fakeT as never
    );
    expect(rows.find(r => r.key === 'paidHolidayHours')?.value).toBe('8h paid');
  });

  it('a null credit reads as not-set — never a fabricated 8h', () => {
    const rows = buildTermRows(
      { ...fullArrangement, holiday_hours_minutes: null },
      fakeT as never
    );
    expect(rows.find(r => r.key === 'paidHolidayHours')?.value).toBeNull();
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
      worked_holiday_multiplier: undefined,
      holiday_hours_minutes: undefined,
    };
    const byKey = Object.fromEntries(
      buildTermRows(preMigration, fakeT as never).map(r => [r.key, r.value])
    );
    expect(byKey.dailyOvertime).toBeNull();
    expect(byKey.doubletime).toBeNull();
    expect(byKey.seventhDay).toBeNull();
    expect(byKey.workedHolidayPremium).toBeNull();
    expect(byKey.paidHolidayHours).toBeNull();
  });

  it('a null term renders null value (caller applies "Not set")', () => {
    const rows = buildTermRows(emptyArrangement, fakeT as never);
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));
    expect(byKey.overtime).toBeNull();
    expect(byKey.dailyOvertime).toBeNull();
    expect(byKey.doubletime).toBeNull();
    expect(byKey.seventhDay).toBeNull();
    expect(byKey.workedHolidayPremium).toBeNull();
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
