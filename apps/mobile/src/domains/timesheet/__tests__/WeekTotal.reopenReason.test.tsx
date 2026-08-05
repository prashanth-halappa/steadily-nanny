/**
 * @module domains/timesheet/__tests__/WeekTotal.reopenReason.test
 *
 * Cold-mount reopen reason lives on `WeekTotal` (a timesheet-status fact),
 * not inside `WeekEarningsLine`'s earnings arms. `useReopenedNotice` only
 * fires when this instance watched approved→submitted; a carer who opens
 * the app days later needs the reason from the timesheet row itself.
 * Overrides the global key-echo i18n mock so `{{reason}}` actually lands
 * in the tree — same pattern as EarningsBreakdownSheet.i18n.test.tsx.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
}));

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && typeof options.reason === 'string') {
        return `${key}::${options.reason}`;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: mock() },
}));

let WeekTotal: typeof import('../components/WeekTotal').WeekTotal;

beforeAll(async () => {
  WeekTotal = (await import('../components/WeekTotal')).WeekTotal;
});

const okEarnings = {
  status: 'ok' as const,
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [],
  gross_minor: 23612,
  reimbursements_minor: 0,
  worked_minutes: 2460,
  payable_minutes: 2460,
  guaranteed_minutes_per_week: null,
};

const REASON = 'Thursday hours were wrong';

const baseProps = {
  testID: 'hours-week-total',
  weekRangeLabel: '3 Aug – 9 Aug',
  totalLabel: '41h 0m',
  overtimeLabel: null as string | null,
  totalMinutes: 2460,
  timesheetStatus: 'submitted' as const,
  earnings: okEarnings,
};

describe('WeekTotal — reopenReason (cold-mount caption)', () => {
  it('nanny: renders the family reason on a non-approved week', () => {
    const { getByTestId, getByText } = render(
      <WeekTotal
        {...baseProps}
        earningsRole="nanny"
        earningsReopenReason={REASON}
      />
    );
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(
      getByText(`earningsReopenedWithReasonNanny::${REASON}`)
    ).toBeTruthy();
  });

  it('parent: renders their own stated reason on a non-approved week', () => {
    const { getByTestId, getByText } = render(
      <WeekTotal
        {...baseProps}
        earningsRole="parent"
        earningsReopenReason={REASON}
      />
    );
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(
      getByText(`earningsReopenedWithReasonParent::${REASON}`)
    ).toBeTruthy();
  });

  it('does NOT render a stale reason on an approved week', () => {
    const { queryByTestId, queryByText } = render(
      <WeekTotal
        {...baseProps}
        timesheetStatus="approved"
        earningsRole="nanny"
        earningsReopenReason={REASON}
      />
    );
    expect(queryByTestId('hours-earnings-line-reopened-note')).toBeNull();
    expect(queryByText(new RegExp(REASON))).toBeNull();
  });

  it('with no reason, the ephemeral reopened flag still shows the generic caption', () => {
    const { getByTestId, getByText, queryByText } = render(
      <WeekTotal {...baseProps} earningsRole="nanny" earningsReopened />
    );
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(getByText('earningsReopenedNote')).toBeTruthy();
    expect(queryByText(/earningsReopenedWithReason/)).toBeNull();
  });

  it('reason takes the slot over the generic caption when both are present', () => {
    const { getByText, queryByText } = render(
      <WeekTotal
        {...baseProps}
        earningsRole="nanny"
        earningsReopened
        earningsReopenReason={REASON}
      />
    );
    expect(
      getByText(`earningsReopenedWithReasonNanny::${REASON}`)
    ).toBeTruthy();
    expect(queryByText('earningsReopenedNote')).toBeNull();
  });

  it('renders the reason on a no_arrangement week', () => {
    const { getByTestId, getByText } = render(
      <WeekTotal
        {...baseProps}
        earnings={{
          status: 'no_arrangement',
          week_start: '2026-08-03',
          unpriced_dates: ['2026-08-03'],
        }}
        earningsRole="parent"
        earningsCarerId="carer-1"
        earningsReopenReason={REASON}
      />
    );
    expect(getByText('earningsNoArrangementParent')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(
      getByText(`earningsReopenedWithReasonParent::${REASON}`)
    ).toBeTruthy();
  });

  it('renders the reason when the earnings line is omitted (zero hours)', () => {
    const { getByTestId, queryByTestId, getByText } = render(
      <WeekTotal
        {...baseProps}
        totalLabel="0m"
        totalMinutes={0}
        earnings={{
          ...okEarnings,
          gross_minor: 0,
          worked_minutes: 0,
          payable_minutes: 0,
        }}
        earningsRole="nanny"
        earningsReopenReason={REASON}
      />
    );
    expect(queryByTestId('hours-earnings-line')).toBeNull();
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(
      getByText(`earningsReopenedWithReasonNanny::${REASON}`)
    ).toBeTruthy();
  });
});
