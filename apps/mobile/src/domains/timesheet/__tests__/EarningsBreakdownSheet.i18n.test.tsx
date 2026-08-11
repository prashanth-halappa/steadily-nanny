/**
 * @module domains/timesheet/__tests__/EarningsBreakdownSheet.i18n.test
 *
 * review finding 9a — `EarningsBreakdownSheet.test.tsx` renders under the
 * global key-echo `react-i18next` mock (`bun.setup.ts`: `t: (key) => key`),
 * which drops every interpolation argument, so it cannot see WHAT VALUE the
 * component actually hands `t()` for the overtime subline's `{{multiplier}}`
 * — only that a call happened. This file overrides `useTranslation`
 * LOCALLY (one file per process — this override cannot leak into any other
 * test file) to capture the real call arguments, proving the component
 * passes a locale-formatted multiplier string (`formatEarningsMultiplier`,
 * `utils/earningsFormat.ts`) rather than the raw JS number.
 */
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import i18n from '@/src/i18n';
import type { WeekEarningsOk } from '../types';

const capturedTCalls: Array<{
  key: string;
  options?: Record<string, unknown>;
}> = [];

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      capturedTCalls.push({ key, options });
      return key;
    },
    i18n: { language: i18n.language, changeLanguage: i18n.changeLanguage },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

let EarningsBreakdownSheet: typeof import('../components/EarningsBreakdownSheet').EarningsBreakdownSheet;

beforeAll(async () => {
  EarningsBreakdownSheet = (
    await import('../components/EarningsBreakdownSheet')
  ).EarningsBreakdownSheet;
});

function overtimeEarnings(): WeekEarningsOk {
  return {
    status: 'ok',
    week_start: '2026-08-03',
    currency: 'GBP',
    lines: [
      {
        kind: 'overtime',
        minutes: 180,
        rate_minor: 2775,
        multiplier: 1.5,
        amount_minor: 8325,
        from_date: '2026-08-03',
        to_date: '2026-08-09',
        arrangement_id: 'arr-1',
      },
    ],
    gross_minor: 8325,
    reimbursements_minor: 0,
    worked_minutes: 180,
    payable_minutes: 180,
    guaranteed_minutes_per_week: null,
  };
}

describe('EarningsBreakdownSheet — overtime multiplier i18n (review finding 9a)', () => {
  afterEach(async () => {
    capturedTCalls.length = 0;
    await i18n.changeLanguage('en');
  });

  it('passes a period-decimal multiplier string in English', () => {
    render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={overtimeEarnings()}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );
    const call = capturedTCalls.find(
      c => c.key === 'earningsLineOvertimeSubline'
    );
    expect(call?.options?.multiplier).toBe('1.5');
  });

  it('passes a comma-decimal multiplier string in Spanish, not the raw "1.5" number', async () => {
    await i18n.changeLanguage('es');
    render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={overtimeEarnings()}
        weekRangeLabel="3 Ago – 9 Ago"
      />
    );
    const call = capturedTCalls.find(
      c => c.key === 'earningsLineOvertimeSubline'
    );
    expect(call?.options?.multiplier).toBe('1,5');
  });
});

// 3-E2's `doubletime` row carries a multiplier exactly like `overtime` does,
// so it inherits the same hazard: the raw JS number interpolated straight
// into the subline prints the period-decimal English form in every locale.
describe('EarningsBreakdownSheet — double-time multiplier i18n', () => {
  afterEach(async () => {
    capturedTCalls.length = 0;
    await i18n.changeLanguage('en');
  });

  function doubletimeEarnings(multiplier: number): WeekEarningsOk {
    return {
      ...overtimeEarnings(),
      lines: [
        {
          kind: 'doubletime',
          minutes: 120,
          rate_minor: 3700,
          multiplier,
          amount_minor: 7400,
          from_date: '2026-08-08',
          to_date: '2026-08-08',
          arrangement_id: 'arr-1',
        },
      ],
      gross_minor: 7400,
    };
  }

  it('passes the multiplier as a formatted STRING, not the raw number', () => {
    render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={doubletimeEarnings(2)}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );
    const call = capturedTCalls.find(
      c => c.key === 'earningsLineDoubletimeSubline'
    );
    expect(call?.options?.multiplier).toBe('2');
    expect(typeof call?.options?.multiplier).toBe('string');
  });

  it('uses the locale decimal separator in Spanish', async () => {
    await i18n.changeLanguage('es');
    render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={doubletimeEarnings(2.5)}
        weekRangeLabel="3 Ago – 9 Ago"
      />
    );
    const call = capturedTCalls.find(
      c => c.key === 'earningsLineDoubletimeSubline'
    );
    expect(call?.options?.multiplier).toBe('2,5');
  });
});

// 3-E4's `holiday_premium` row carries a multiplier for the same reason and
// with the same hazard — and it is the ONE row whose multiplier is not the
// rate it is priced at, so the number in the copy has to be exactly the
// multiplier that was agreed.
describe('EarningsBreakdownSheet — holiday premium multiplier i18n', () => {
  afterEach(async () => {
    capturedTCalls.length = 0;
    await i18n.changeLanguage('en');
  });

  function holidayPremiumEarnings(multiplier: number): WeekEarningsOk {
    return {
      ...overtimeEarnings(),
      lines: [
        {
          kind: 'holiday_premium',
          minutes: 480,
          // The PREMIUM-ONLY rate: $28.00/h at 1.5× leaves $14.00 on top.
          rate_minor: 1400,
          multiplier,
          amount_minor: 11200,
          from_date: '2026-08-03',
          to_date: '2026-08-03',
          arrangement_id: 'arr-1',
        },
      ],
      gross_minor: 11200,
    };
  }

  it('passes the multiplier as a formatted STRING, not the raw number', () => {
    render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={holidayPremiumEarnings(1.5)}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );
    const call = capturedTCalls.find(
      c => c.key === 'earningsLineHolidayPremiumSubline'
    );
    expect(call?.options?.multiplier).toBe('1.5');
    expect(typeof call?.options?.multiplier).toBe('string');
  });

  it('uses the locale decimal separator in Spanish', async () => {
    await i18n.changeLanguage('es');
    render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={holidayPremiumEarnings(2.5)}
        weekRangeLabel="3 Ago – 9 Ago"
      />
    );
    const call = capturedTCalls.find(
      c => c.key === 'earningsLineHolidayPremiumSubline'
    );
    expect(call?.options?.multiplier).toBe('2,5');
  });
});

// The adjustment's reason is free text a parent typed. It must reach the
// carer VERBATIM as an interpolated value — never treated as a key, and
// never reworded — which the key-echo suite cannot see.
describe('EarningsBreakdownSheet — the adjustment note is interpolated, not keyed', () => {
  afterEach(() => {
    capturedTCalls.length = 0;
  });

  function adjustedEarnings(amountMinor: number, note: string): WeekEarningsOk {
    return {
      ...overtimeEarnings(),
      gross_minor: 8325 + amountMinor,
      adjustment: {
        amount_minor: amountMinor,
        note,
        created_by: '11111111-1111-4111-8111-111111111111',
        created_at: '2026-08-10T09:00:00.000Z',
      },
    };
  }

  it('passes the reason through as `note`, character for character', () => {
    const note = 'Bus fares for the school run — £4.80 × 5';
    render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={adjustedEarnings(-2400, note)}
        weekRangeLabel="3 Aug – 9 Aug"
        earningsRole="nanny"
      />
    );

    const call = capturedTCalls.find(
      c => c.key === 'earningsLineAdjustmentDeductedNanny'
    );
    expect(call?.options?.note).toBe(note);
    // The note is never itself handed to `t()` as a key.
    expect(capturedTCalls.some(c => c.key === note)).toBe(false);
  });
});
