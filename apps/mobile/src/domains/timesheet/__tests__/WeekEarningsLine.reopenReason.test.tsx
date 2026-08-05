/**
 * @module domains/timesheet/__tests__/WeekEarningsLine.reopenReason.test
 *
 * Cold-mount reopen reason: `useReopenedNotice` only fires when this
 * instance watched approved→submitted. A carer who opens the app days later
 * needs the reason from the timesheet row itself. Overrides the global
 * key-echo i18n mock so `{{reason}}` actually lands in the tree — same
 * pattern as EarningsBreakdownSheet.i18n.test.tsx.
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

let WeekEarningsLine: typeof import('../components/WeekEarningsLine').WeekEarningsLine;

beforeAll(async () => {
  WeekEarningsLine = (await import('../components/WeekEarningsLine'))
    .WeekEarningsLine;
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

describe('WeekEarningsLine — reopenReason (cold-mount caption)', () => {
  it('nanny: renders the family reason on a non-approved week', () => {
    const { getByTestId, getByText } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="nanny"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
        reopenReason={REASON}
      />
    );
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(
      getByText(`earningsReopenedWithReasonNanny::${REASON}`)
    ).toBeTruthy();
  });

  it('parent: renders their own stated reason on a non-approved week', () => {
    const { getByTestId, getByText } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
        reopenReason={REASON}
      />
    );
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(
      getByText(`earningsReopenedWithReasonParent::${REASON}`)
    ).toBeTruthy();
  });

  it('does NOT render a stale reason on an approved week', () => {
    const { queryByTestId, queryByText } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="approved"
        viewerRole="nanny"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
        reopenReason={REASON}
      />
    );
    expect(queryByTestId('hours-earnings-line-reopened-note')).toBeNull();
    expect(queryByText(new RegExp(REASON))).toBeNull();
  });

  it('with no reason, the ephemeral reopened flag still shows the generic caption', () => {
    const { getByTestId, getByText, queryByText } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="nanny"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
        reopened
      />
    );
    expect(getByTestId('hours-earnings-line-reopened-note')).toBeTruthy();
    expect(getByText('earningsReopenedNote')).toBeTruthy();
    expect(queryByText(/earningsReopenedWithReason/)).toBeNull();
  });

  it('reason takes the slot over the generic caption when both are present', () => {
    const { getByText, queryByText } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="nanny"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
        reopened
        reopenReason={REASON}
      />
    );
    expect(
      getByText(`earningsReopenedWithReasonNanny::${REASON}`)
    ).toBeTruthy();
    expect(queryByText('earningsReopenedNote')).toBeNull();
  });
});
