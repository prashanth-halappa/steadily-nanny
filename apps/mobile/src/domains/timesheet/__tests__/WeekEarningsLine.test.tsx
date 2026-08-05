/**
 * @module domains/timesheet/__tests__/WeekEarningsLine.test
 * TIER0-CX-SPEC.md §4.1/§4.4/§4.5/§8 — every arm of the money line.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { WeekEarningsLine } from '../components/WeekEarningsLine';

const routerPush = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({ push: routerPush, back: mock(), replace: mock() }),
}));

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

describe('WeekEarningsLine', () => {
  it('renders nothing when earnings is null (loading / no timesheet yet)', () => {
    const { queryByTestId } = render(
      <WeekEarningsLine
        earnings={null}
        timesheetStatus={null}
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={0}
      />
    );
    expect(queryByTestId('hours-earnings-line')).toBeNull();
  });

  it('estimated arm: "Estimated gross" label + amount, tappable', () => {
    const onPress = mock();
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
        onPress={onPress}
      />
    );
    expect(getByTestId('hours-earnings-line')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
    fireEvent.press(getByTestId('hours-earnings-line-pressable'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('approved arm: "Approved gross" label from the frozen snapshot', () => {
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="approved"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    // react-i18next is key-echo-mocked; the label rendered IS the key.
    expect(
      getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
    ).toContain('earningsApprovedGross');
  });

  it('queried arm: adds the "queried, may change" caption', () => {
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="queried"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(getByTestId('hours-earnings-line-queried-note')).toBeTruthy();
  });

  // Ephemeral / wire reopen captions live on `WeekTotal` now — see
  // `WeekTotal.reopenReason.test.tsx` and `WeekTotal.test.tsx`.

  it('hours-only/legacy_approval: renders nothing at all', () => {
    const { queryByTestId } = render(
      <WeekEarningsLine
        earnings={{
          status: 'hours_only',
          week_start: '2026-08-03',
          reason: 'legacy_approval',
        }}
        timesheetStatus="approved"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(queryByTestId('hours-earnings-line')).toBeNull();
  });

  it('hours-only/unreadable_snapshot: renders nothing at all', () => {
    const { queryByTestId } = render(
      <WeekEarningsLine
        earnings={{
          status: 'hours_only',
          week_start: '2026-08-03',
          reason: 'unreadable_snapshot',
        }}
        timesheetStatus="approved"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(queryByTestId('hours-earnings-line')).toBeNull();
  });

  it('hours-only/carer_removed: renders the departed-carer caption, never the set-a-rate nudge', () => {
    const { getByTestId, queryByTestId } = render(
      <WeekEarningsLine
        earnings={{
          status: 'hours_only',
          week_start: '2026-08-03',
          reason: 'carer_removed',
        }}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId={null}
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(getByTestId('hours-earnings-line')).toBeTruthy();
    expect(queryByTestId('hours-earnings-line-set-rate')).toBeNull();
  });

  describe('no_arrangement — role-asymmetric nudge', () => {
    const noArrangement = {
      status: 'no_arrangement' as const,
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };

    it('parent: shows the "Set a pay rate" button, routing to the setup screen for THIS carer', () => {
      const { getByTestId } = render(
        <WeekEarningsLine
          earnings={noArrangement}
          timesheetStatus="submitted"
          viewerRole="parent"
          carerId="carer-42"
          carerDisplayName="Amara"
          totalMinutes={2460}
        />
      );
      fireEvent.press(getByTestId('hours-earnings-line-set-rate'));
      expect(routerPush).toHaveBeenCalledWith('/settings/pay/setup/carer-42');
    });

    it('nanny: sentence only, no control', () => {
      const { queryByTestId } = render(
        <WeekEarningsLine
          earnings={noArrangement}
          timesheetStatus="submitted"
          viewerRole="nanny"
          carerId="carer-42"
          carerDisplayName="Amara"
          totalMinutes={2460}
        />
      );
      expect(queryByTestId('hours-earnings-line-set-rate')).toBeNull();
    });
  });

  describe('no_arrangement — approved & frozen (review finding 3)', () => {
    const noArrangement = {
      status: 'no_arrangement' as const,
      week_start: '2026-08-03',
      unpriced_dates: ['2026-08-03'],
    };

    it('parent: an approved week never shows the unkeepable "Set a pay rate" CTA', () => {
      const { getByTestId, getByText, queryByTestId } = render(
        <WeekEarningsLine
          earnings={noArrangement}
          timesheetStatus="approved"
          viewerRole="parent"
          carerId="carer-42"
          carerDisplayName="Amara"
          totalMinutes={2460}
        />
      );
      expect(getByTestId('hours-earnings-line')).toBeTruthy();
      expect(queryByTestId('hours-earnings-line-set-rate')).toBeNull();
      // The mandatory Approved/Estimated state word must still be present.
      expect(getByText('earningsNoArrangementApproved')).toBeTruthy();
    });

    it('nanny: an approved week keeps the sentence-only treatment (no control either way)', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekEarningsLine
          earnings={noArrangement}
          timesheetStatus="approved"
          viewerRole="nanny"
          carerId="carer-42"
          carerDisplayName="Amara"
          totalMinutes={2460}
        />
      );
      expect(getByTestId('hours-earnings-line')).toBeTruthy();
      expect(queryByTestId('hours-earnings-line-set-rate')).toBeNull();
    });
  });

  it('currency_change arm: renders its sentence, no number', () => {
    const { getByTestId, queryByTestId } = render(
      <WeekEarningsLine
        earnings={{
          status: 'currency_change',
          week_start: '2026-08-03',
          currencies: ['GBP', 'EUR'],
        }}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(getByTestId('hours-earnings-line')).toBeTruthy();
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
  });

  it('currency_change arm, approved & frozen: distinct copy, no forever-unfixable "ask your family" caption (review finding 3)', () => {
    const { getByText } = render(
      <WeekEarningsLine
        earnings={{
          status: 'currency_change',
          week_start: '2026-08-03',
          currencies: ['GBP', 'EUR'],
        }}
        timesheetStatus="approved"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(getByText('earningsCurrencyChangeApproved')).toBeTruthy();
  });

  it('zero hours + zero gross: renders nothing (never £0.00)', () => {
    const { queryByTestId } = render(
      <WeekEarningsLine
        earnings={{ ...okEarnings, gross_minor: 0, worked_minutes: 0 }}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={0}
      />
    );
    expect(queryByTestId('hours-earnings-line')).toBeNull();
  });

  it('zero hours BUT a guaranteed top-up still renders the line (closure-week exception)', () => {
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={{
          ...okEarnings,
          gross_minor: 74000,
          worked_minutes: 0,
          guaranteed_minutes_per_week: 2400,
        }}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={0}
      />
    );
    expect(getByTestId('hours-earnings-line')).toBeTruthy();
  });

  it('earnings error: hours-independent — shows the retry caption, not the amount', () => {
    const onRetry = mock();
    const { getByTestId, queryByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
        earningsError
        onRetryEarnings={onRetry}
      />
    );
    expect(queryByTestId('hours-earnings-line-amount')).toBeNull();
    fireEvent.press(getByTestId('hours-earnings-line-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
