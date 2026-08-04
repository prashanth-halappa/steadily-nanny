/**
 * @module domains/timesheet/__tests__/EarningsBreakdownSheet.test
 * TIER0-CX-SPEC.md §4.2 — fixed line order, mid-week split rows, labels,
 * total, reimbursements note, footer.
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { EarningsBreakdownSheet } from '../components/EarningsBreakdownSheet';
import type { WeekEarningsOk } from '../types';

function baseEarnings(overrides: Partial<WeekEarningsOk> = {}): WeekEarningsOk {
  return {
    status: 'ok',
    week_start: '2026-08-03',
    currency: 'GBP',
    lines: [],
    gross_minor: 0,
    reimbursements_minor: 0,
    worked_minutes: 0,
    payable_minutes: 0,
    guaranteed_minutes_per_week: null,
    ...overrides,
  };
}

describe('EarningsBreakdownSheet', () => {
  it('renders lines in the fixed order, then the total row', () => {
    const earnings = baseEarnings({
      lines: [
        {
          kind: 'regular',
          minutes: 2280,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 42180,
          from_date: '2026-08-03',
          to_date: '2026-08-07',
          arrangement_id: 'arr-1',
        },
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
        {
          kind: 'cancellation_paid',
          minutes: 240,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 7400,
          from_date: '2026-08-08',
          to_date: '2026-08-08',
          arrangement_id: 'arr-1',
        },
      ],
      gross_minor: 57905,
      worked_minutes: 2460,
      payable_minutes: 2700,
    });

    const { getByTestId } = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={earnings}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );

    expect(getByTestId('hours-earnings-breakdown-line-regular-0')).toBeTruthy();
    expect(getByTestId('hours-earnings-breakdown-line-overtime')).toBeTruthy();
    expect(
      getByTestId('hours-earnings-breakdown-line-cancellation')
    ).toBeTruthy();
    expect(getByTestId('hours-earnings-breakdown-total').props.children).toBe(
      '£579.05'
    );
  });

  it('splits a mid-week rate change into two "Hours worked" rows with date-span sublines', () => {
    const earnings = baseEarnings({
      lines: [
        {
          kind: 'regular',
          minutes: 720,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 22200,
          from_date: '2026-08-31',
          to_date: '2026-09-02',
          arrangement_id: 'arr-old',
        },
        {
          kind: 'regular',
          minutes: 1560,
          rate_minor: 1950,
          multiplier: null,
          amount_minor: 50700,
          from_date: '2026-09-03',
          to_date: '2026-09-06',
          arrangement_id: 'arr-new',
        },
      ],
      gross_minor: 72900,
      worked_minutes: 2280,
      payable_minutes: 2280,
    });

    const { getByTestId, getAllByText } = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={earnings}
        weekRangeLabel="31 Aug – 6 Sep"
      />
    );

    expect(getByTestId('hours-earnings-breakdown-line-regular-0')).toBeTruthy();
    expect(getByTestId('hours-earnings-breakdown-line-regular-1')).toBeTruthy();
    // Both rows use the same label ("Hours worked" ×2 rows, per spec table).
    expect(getAllByText('earningsLineRegular').length).toBe(2);
  });

  it('shows the topup row with its closure sub-line, and the zero-hours addendum on a closure-only week', () => {
    const earnings = baseEarnings({
      lines: [
        {
          kind: 'guaranteed_topup',
          minutes: 2400,
          rate_minor: 1850,
          multiplier: null,
          amount_minor: 74000,
          from_date: '2026-08-03',
          to_date: '2026-08-09',
          arrangement_id: 'arr-1',
        },
      ],
      gross_minor: 74000,
      worked_minutes: 0,
      payable_minutes: 0,
      guaranteed_minutes_per_week: 2400,
    });

    const { getByTestId } = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={earnings}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );

    expect(getByTestId('hours-earnings-breakdown-line-topup')).toBeTruthy();
    expect(
      getByTestId('hours-earnings-breakdown-line-topup-zero-hours-note')
    ).toBeTruthy();
  });

  it('shows "Estimated" when no approved date is supplied, "Approved {date}" when it is', () => {
    const earnings = baseEarnings();

    const estimated = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={earnings}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );
    expect(
      estimated.getByTestId('hours-earnings-breakdown-subheader').props.children
    ).toContain('earningsBreakdownEstimated');

    const approved = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={earnings}
        weekRangeLabel="3 Aug – 9 Aug"
        approvedDateLabel="10 August"
      />
    );
    expect(
      approved.getByTestId('hours-earnings-breakdown-subheader').props.children
    ).toContain('earningsBreakdownApproved');
  });

  it('renders the reimbursements note only when reimbursements exist', () => {
    const withReimbursements = baseEarnings({ reimbursements_minor: 3480 });
    const { getByTestId } = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={withReimbursements}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );
    expect(
      getByTestId('hours-earnings-breakdown-reimbursements-note')
    ).toBeTruthy();

    const withoutReimbursements = baseEarnings({ reimbursements_minor: 0 });
    const { queryByTestId } = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={withoutReimbursements}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );
    expect(
      queryByTestId('hours-earnings-breakdown-reimbursements-note')
    ).toBeNull();
  });

  it('always renders the payroll footer note', () => {
    const { getByText } = render(
      <EarningsBreakdownSheet
        visible
        onDismiss={() => {}}
        earnings={baseEarnings()}
        weekRangeLabel="3 Aug – 9 Aug"
      />
    );
    expect(getByText('earningsFooterNote')).toBeTruthy();
  });
});
