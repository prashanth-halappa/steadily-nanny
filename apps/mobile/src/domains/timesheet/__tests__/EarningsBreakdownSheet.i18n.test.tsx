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
