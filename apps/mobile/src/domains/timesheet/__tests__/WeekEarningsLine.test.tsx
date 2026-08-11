/**
 * @module domains/timesheet/__tests__/WeekEarningsLine.test
 * TIER0-CX-SPEC.md §4.1/§4.4/§4.5/§8 — every arm of the money line.
 *
 * The cascade that picks the arm is now the pure `weekEarningsSectionKind`,
 * because `WeekMoneyCard` has to ask "is there anything here at all?" without
 * rendering. It gets its own unit suite below — a renderless assertion of the
 * same rules the component tests exercise end to end, so the two can never
 * drift into disagreeing about when the money block disappears.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import {
  WeekEarningsLine,
  weekEarningsSectionKind,
} from '../components/WeekEarningsLine';
import type { WeekEarningsStateResult } from '../types';

type OkEarnings = Extract<WeekEarningsStateResult, { status: 'ok' }>;
type EarningsLine = OkEarnings['lines'][number];

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

  // The recessed money plate is gone: the section no longer draws a pressable
  // muted row with a chevron, because `WeekMoneyCard` now owns the one card
  // the money block gets. What survives is the rule the plate encoded — the
  // `ok` arm is the ONLY arm that gets chip + amount + a way into the
  // breakdown, and a caption arm gets none of them.
  it('ok arm: chip, amount and a breakdown link; no_arrangement gets none of them', () => {
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(getByTestId('hours-earnings-line-chip')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-amount')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-pressable')).toBeTruthy();

    const { getByTestId: getNoArrangement, queryByTestId: queryNoArrangement } =
      render(
        <WeekEarningsLine
          earnings={{
            status: 'no_arrangement',
            week_start: '2026-08-03',
            unpriced_dates: ['2026-08-03'],
          }}
          timesheetStatus="submitted"
          viewerRole="nanny"
          carerId="carer-42"
          carerDisplayName="Amara"
          totalMinutes={2460}
        />
      );
    expect(getNoArrangement('hours-earnings-line')).toBeTruthy();
    expect(queryNoArrangement('hours-earnings-line-chip')).toBeNull();
    expect(queryNoArrangement('hours-earnings-line-amount')).toBeNull();
    expect(queryNoArrangement('hours-earnings-line-pressable')).toBeNull();
  });

  it('ok arm: the way into the breakdown is a labelled link, not a bare chevron', () => {
    const { getByTestId, getByText } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(getByText('earningsSeeBreakdown')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-pressable')).toBeTruthy();
  });

  it('carries no wrapper margin — the money card owns the spacing now', () => {
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(getByTestId('hours-earnings-line').props.className).not.toContain(
      'mt-4'
    );
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

  it('carerName folds into the accessibilityLabel only, never the visible label', () => {
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        carerName="Amara"
        totalMinutes={2460}
      />
    );
    expect(
      getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
    ).toBe('Amara: earningsEstimatedGross £236.12');
  });

  it('without a carerName, the accessibilityLabel is unchanged (backwards compatible)', () => {
    const { getByTestId } = render(
      <WeekEarningsLine
        earnings={okEarnings}
        timesheetStatus="submitted"
        viewerRole="parent"
        carerId="carer-1"
        carerDisplayName="Amara"
        totalMinutes={2460}
      />
    );
    expect(
      getByTestId('hours-earnings-line-pressable').props.accessibilityLabel
    ).toBe('earningsEstimatedGross £236.12');
  });

  describe('the rate sub-line states only a rate that is actually true', () => {
    const line = (over: Partial<EarningsLine> = {}): EarningsLine => ({
      kind: 'regular',
      minutes: 1200,
      rate_minor: 1200,
      multiplier: null,
      amount_minor: 24000,
      from_date: '2026-08-03',
      to_date: '2026-08-04',
      arrangement_id: null,
      ...over,
    });

    it('shows it when the whole week priced at one rate', () => {
      const { getByTestId } = render(
        <WeekEarningsLine
          earnings={{ ...okEarnings, lines: [line(), line()] }}
          timesheetStatus="submitted"
          viewerRole="parent"
          carerId="carer-1"
          carerDisplayName="Amara"
          totalMinutes={2400}
        />
      );
      expect(getByTestId('hours-earnings-line-rate')).toBeTruthy();
    });

    // §11.1: a mid-week raise no longer disappears silently — the structure
    // line takes over from the single-rate subline in the same slot, because
    // it is always producible (kind-grouped, not rate-grouped).
    it('falls back to the structure line across a mid-week raise', () => {
      const { getByTestId } = render(
        <WeekEarningsLine
          earnings={{
            ...okEarnings,
            lines: [line(), line({ rate_minor: 1350 })],
          }}
          timesheetStatus="submitted"
          viewerRole="parent"
          carerId="carer-1"
          carerDisplayName="Amara"
          totalMinutes={2400}
        />
      );
      expect(getByTestId('hours-earnings-line-rate').props.children).toBe(
        '40h = 40 reg'
      );
    });

    it('falls back to the structure line when any line carries an overtime multiplier', () => {
      const { getByTestId } = render(
        <WeekEarningsLine
          earnings={{
            ...okEarnings,
            lines: [line(), line({ kind: 'overtime', multiplier: 1.5 })],
          }}
          timesheetStatus="submitted"
          viewerRole="parent"
          carerId="carer-1"
          carerDisplayName="Amara"
          totalMinutes={2400}
        />
      );
      expect(getByTestId('hours-earnings-line-rate').props.children).toBe(
        '40h = 20 reg + 20 OT'
      );
    });

    it('appends the nothing-unusual clause when the server says so (D-5, §11.1.1)', () => {
      const { getByTestId } = render(
        <WeekEarningsLine
          earnings={{ ...okEarnings, lines: [line(), line()] }}
          timesheetStatus="submitted"
          viewerRole="parent"
          carerId="carer-1"
          carerDisplayName="Amara"
          totalMinutes={2400}
          nothingUnusual
        />
      );
      // The hook's `t` is key-echoed under test (docs/09-TESTING.md §6) —
      // asserting on the key is exactly how the rest of this file pins
      // translated copy, e.g. `'earningsEstimatedGross'` above.
      expect(getByTestId('hours-earnings-line-rate').props.children).toBe(
        'earningsRateSubline · earningsNothingUnusualSuffix'
      );
    });

    it('omits the nothing-unusual clause when the server says nothing', () => {
      const { getByTestId } = render(
        <WeekEarningsLine
          earnings={{ ...okEarnings, lines: [line(), line()] }}
          timesheetStatus="submitted"
          viewerRole="parent"
          carerId="carer-1"
          carerDisplayName="Amara"
          totalMinutes={2400}
          nothingUnusual={false}
        />
      );
      expect(
        getByTestId('hours-earnings-line-rate').props.children
      ).not.toContain('earningsNothingUnusualSuffix');
    });

    it('withholds it when no line has priced minutes at all', () => {
      const { getByTestId, queryByTestId } = render(
        <WeekEarningsLine
          earnings={{
            ...okEarnings,
            gross_minor: 74000,
            lines: [line({ kind: 'guaranteed_topup', minutes: 0 })],
          }}
          timesheetStatus="submitted"
          viewerRole="parent"
          carerId="carer-1"
          carerDisplayName="Amara"
          totalMinutes={0}
        />
      );
      expect(getByTestId('hours-earnings-line-amount')).toBeTruthy();
      expect(queryByTestId('hours-earnings-line-rate')).toBeNull();
    });
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

describe('weekEarningsSectionKind — the cascade, without a renderer', () => {
  it("'none' when there are no earnings yet — loading is never a £0.00 placeholder", () => {
    expect(
      weekEarningsSectionKind({ earnings: null, totalMinutes: 2460 })
    ).toBe('none');
  });

  it("'error' wins over everything, including a perfectly good ok result", () => {
    expect(
      weekEarningsSectionKind({
        earnings: okEarnings,
        totalMinutes: 2460,
        earningsError: true,
      })
    ).toBe('error');
    // …and over a null result, so the retry is offered rather than silence.
    expect(
      weekEarningsSectionKind({
        earnings: null,
        totalMinutes: 0,
        earningsError: true,
      })
    ).toBe('error');
  });

  it("'departed' only for hours_only/carer_removed", () => {
    expect(
      weekEarningsSectionKind({
        earnings: {
          status: 'hours_only',
          week_start: '2026-08-03',
          reason: 'carer_removed',
        },
        totalMinutes: 2460,
      })
    ).toBe('departed');
  });

  it("'none' for the other two hours_only reasons — there is nothing actionable to say", () => {
    expect(
      weekEarningsSectionKind({
        earnings: {
          status: 'hours_only',
          week_start: '2026-08-03',
          reason: 'legacy_approval',
        },
        totalMinutes: 2460,
      })
    ).toBe('none');
    expect(
      weekEarningsSectionKind({
        earnings: {
          status: 'hours_only',
          week_start: '2026-08-03',
          reason: 'unreadable_snapshot',
        },
        totalMinutes: 2460,
      })
    ).toBe('none');
  });

  it("'no-arrangement' — never a £0.00", () => {
    expect(
      weekEarningsSectionKind({
        earnings: {
          status: 'no_arrangement',
          week_start: '2026-08-03',
          unpriced_dates: ['2026-08-03'],
        },
        totalMinutes: 2460,
      })
    ).toBe('no-arrangement');
  });

  it("'currency-change'", () => {
    expect(
      weekEarningsSectionKind({
        earnings: {
          status: 'currency_change',
          week_start: '2026-08-03',
          currencies: ['GBP', 'EUR'],
        },
        totalMinutes: 2460,
      })
    ).toBe('currency-change');
  });

  it("'ok' for a priced week with hours", () => {
    expect(
      weekEarningsSectionKind({ earnings: okEarnings, totalMinutes: 2460 })
    ).toBe('ok');
  });

  it("'none' for a zero-hours, zero-gross week — nothing has happened yet", () => {
    expect(
      weekEarningsSectionKind({
        earnings: { ...okEarnings, gross_minor: 0, worked_minutes: 0 },
        totalMinutes: 0,
      })
    ).toBe('none');
  });

  it("'ok' for a zero-hours week that still tops up — gross_minor, not hours, decides", () => {
    expect(
      weekEarningsSectionKind({
        earnings: {
          ...okEarnings,
          gross_minor: 74000,
          worked_minutes: 0,
          guaranteed_minutes_per_week: 2400,
        },
        totalMinutes: 0,
      })
    ).toBe('ok');
  });

  it("'ok' for a zero-GROSS week that has hours — an unpaid-but-worked week still states its figure", () => {
    expect(
      weekEarningsSectionKind({
        earnings: { ...okEarnings, gross_minor: 0 },
        totalMinutes: 2460,
      })
    ).toBe('ok');
  });
});
