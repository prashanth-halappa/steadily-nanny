/**
 * @module domains/timesheet/__tests__/EarningsBreakdownSheet.test
 * TIER0-CX-SPEC.md §4.2 — fixed line order, mid-week split rows, labels,
 * total, reimbursements note, footer.
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { EarningsBreakdownSheet } from '../components/EarningsBreakdownSheet';
import type { WeekEarningsOk } from '../types';

function cancellationEarnings(): WeekEarningsOk {
  return baseEarnings({
    lines: [
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
    gross_minor: 7400,
    worked_minutes: 240,
    payable_minutes: 240,
  });
}

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

  // 3-E2: the top premium tier. It is a KNOWN kind in this build, so it must
  // get its own localised copy — a row falling through to the humanized
  // fallback is a row with no translation.
  describe('the double-time row', () => {
    function doubletimeEarnings(): WeekEarningsOk {
      return baseEarnings({
        lines: [
          {
            kind: 'regular',
            minutes: 2400,
            rate_minor: 1850,
            multiplier: null,
            amount_minor: 74000,
            from_date: '2026-08-03',
            to_date: '2026-08-07',
            arrangement_id: 'arr-1',
          },
          {
            kind: 'doubletime',
            minutes: 120,
            rate_minor: 3700,
            multiplier: 2,
            amount_minor: 7400,
            from_date: '2026-08-08',
            to_date: '2026-08-08',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 81400,
        worked_minutes: 2520,
        payable_minutes: 2520,
      });
    }

    it('renders its own label, amount and multiplier subline — never the unknown-kind fallback', () => {
      const { getByTestId, getByText, queryByTestId, queryByText } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={doubletimeEarnings()}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      expect(
        getByTestId('hours-earnings-breakdown-line-doubletime')
      ).toBeTruthy();
      expect(
        getByTestId('hours-earnings-breakdown-line-doubletime-value').props
          .children
      ).toBe('£74.00');
      expect(getByText('earningsLineDoubletime')).toBeTruthy();
      expect(getByText('earningsLineDoubletimeSubline')).toBeTruthy();
      // The fallback row, and its humanized label, must both be absent.
      expect(
        queryByTestId('hours-earnings-breakdown-line-unknown-1')
      ).toBeNull();
      expect(queryByText('Doubletime')).toBeNull();
      expect(queryByText('earningsLineUnknownSubline')).toBeNull();
    });
  });

  // 3-E4: the worked-holiday premium. Unlike every tier above it this line is
  // an INCREMENT — its minutes are the SAME minutes already priced on the
  // regular/overtime rows, carried a second time at the premium alone, so its
  // `rate_minor` is $14.00 at $28.00/h and 1.5×, not $42.00.
  describe('the holiday premium row', () => {
    function holidayPremiumEarnings(): WeekEarningsOk {
      return baseEarnings({
        lines: [
          {
            kind: 'regular',
            minutes: 2400,
            rate_minor: 2800,
            multiplier: null,
            amount_minor: 112000,
            from_date: '2026-08-03',
            to_date: '2026-08-07',
            arrangement_id: 'arr-1',
          },
          {
            // The same 480 minutes as one of the regular days above — this
            // row prices the 0.5× on top, nothing else.
            kind: 'holiday_premium',
            minutes: 480,
            rate_minor: 1400,
            multiplier: 1.5,
            amount_minor: 11200,
            from_date: '2026-08-03',
            to_date: '2026-08-03',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 123200,
        worked_minutes: 2400,
        payable_minutes: 2400,
      });
    }

    it('renders its own label, amount and multiplier subline — never the unknown-kind fallback', () => {
      const { getByTestId, getByText, queryByTestId, queryByText } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={holidayPremiumEarnings()}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      expect(
        getByTestId('hours-earnings-breakdown-line-holiday-premium')
      ).toBeTruthy();
      expect(
        getByTestId('hours-earnings-breakdown-line-holiday-premium-value').props
          .children
      ).toBe('£112.00');
      expect(getByText('earningsLineHolidayPremium')).toBeTruthy();
      expect(getByText('earningsLineHolidayPremiumSubline')).toBeTruthy();
      // The fallback row, and its humanized label, must both be absent.
      expect(
        queryByTestId('hours-earnings-breakdown-line-unknown-1')
      ).toBeNull();
      expect(queryByText('Holiday premium')).toBeNull();
      expect(queryByText('earningsLineUnknownSubline')).toBeNull();
    });
  });

  // The fleet rule: a server that starts emitting a seventh kind reaches
  // clients that predate it. This sheet must show the row rather than drop
  // it — a missing row makes the total stop equalling the visible sum, which
  // is the one thing §4.2 says it must never do.
  describe('a line kind this build does not know', () => {
    function unknownKindEarnings(): WeekEarningsOk {
      return baseEarnings({
        lines: [
          {
            kind: 'regular',
            minutes: 2400,
            rate_minor: 1850,
            multiplier: null,
            amount_minor: 74000,
            from_date: '2026-08-03',
            to_date: '2026-08-07',
            arrangement_id: 'arr-1',
          },
          {
            kind: 'night_differential',
            minutes: 120,
            rate_minor: 2000,
            multiplier: null,
            amount_minor: 4000,
            from_date: '2026-08-08',
            to_date: '2026-08-08',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 78000,
        worked_minutes: 2520,
        payable_minutes: 2520,
      });
    }

    it('renders a generic row: humanized label, its amount, and the generic subline', () => {
      const { getByTestId, getByText } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={unknownKindEarnings()}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      const row = getByTestId('hours-earnings-breakdown-line-unknown-1');
      expect(row).toBeTruthy();
      // The label is NOT a translation key — there is no copy for a kind this
      // build has never seen, so the wire value is humanized in place.
      expect(getByText('Night differential')).toBeTruthy();
      expect(
        getByTestId('hours-earnings-breakdown-line-unknown-1-value').props
          .children
      ).toBe('£40.00');
      expect(getByText('earningsLineUnknownSubline')).toBeTruthy();
    });

    it('leaves the known rows exactly as they were', () => {
      const { getByTestId } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={unknownKindEarnings()}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      expect(
        getByTestId('hours-earnings-breakdown-line-regular-0')
      ).toBeTruthy();
      expect(getByTestId('hours-earnings-breakdown-total').props.children).toBe(
        '£780.00'
      );
    });

    it('still keeps reimbursements out of the rows — the ONE exclusion', () => {
      const { queryByText } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={baseEarnings({
            lines: [
              {
                kind: 'reimbursements',
                minutes: 0,
                rate_minor: 0,
                multiplier: null,
                amount_minor: 1250,
                from_date: '2026-08-04',
                to_date: '2026-08-04',
                arrangement_id: null,
              },
            ],
            reimbursements_minor: 1250,
          })}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      expect(queryByText('Reimbursements')).toBeNull();
      expect(queryByText('£12.50')).toBeNull();
    });
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

  // review finding 9b: "paid under your cancellation policy" is
  // parent-voiced copy ("your" = the policy the reader set) but the SAME
  // sheet is shown to the nanny read-only, in her own breakdown. The two
  // roles now get their own key/voice — `EarningsBreakdownSheet` already
  // knows the role (`earningsRole`, same prop shape as `WeekEarningsLine`).
  describe('cancellation subline — role voice (review finding 9b)', () => {
    it('parent: "paid under your cancellation policy" (her own family policy)', () => {
      const { getByText } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={cancellationEarnings()}
          weekRangeLabel="3 Aug – 9 Aug"
          earningsRole="parent"
        />
      );
      expect(getByText('earningsLineCancellationSublineParent')).toBeTruthy();
    });

    it('nanny: a distinct key — never the parent-voiced "your cancellation policy"', () => {
      const { getByText, queryByText } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={cancellationEarnings()}
          weekRangeLabel="3 Aug – 9 Aug"
          earningsRole="nanny"
        />
      );
      expect(getByText('earningsLineCancellationSublineNanny')).toBeTruthy();
      expect(queryByText('earningsLineCancellationSublineParent')).toBeNull();
    });
  });

  // The parent's approval-time adjustment. This sheet is where the NANNY
  // learns of it — it is staged silently and folded in at approval — so the
  // row renders for both roles, with the voice forked and the note verbatim.
  describe('the approval-time adjustment row', () => {
    function adjustedEarnings(
      amountMinor: number,
      note = 'Advance on Friday'
    ): WeekEarningsOk {
      return baseEarnings({
        lines: [
          {
            kind: 'regular',
            minutes: 2460,
            rate_minor: 1850,
            multiplier: null,
            amount_minor: 23612,
            from_date: '2026-08-03',
            to_date: '2026-08-09',
            arrangement_id: 'arr-1',
          },
        ],
        gross_minor: 23612 + amountMinor,
        worked_minutes: 2460,
        payable_minutes: 2460,
        adjustment: {
          amount_minor: amountMinor,
          note,
          created_by: '11111111-1111-4111-8111-111111111111',
          created_at: '2026-08-10T09:00:00.000Z',
        },
      });
    }

    it('renders NO adjustment row on a legacy snapshot that never had the key', () => {
      const { queryByTestId } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={baseEarnings()}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      expect(
        queryByTestId('hours-earnings-breakdown-line-adjustment')
      ).toBeNull();
    });

    it('lets Intl render the minus on a deduction — never a hand-prefixed sign', () => {
      const { getByTestId } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={adjustedEarnings(-2000)}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      expect(
        getByTestId('hours-earnings-breakdown-line-adjustment-value').props
          .children
      ).toBe('-£20.00');
      // The total already includes it — this row explains the total, it does
      // not adjust it a second time.
      expect(getByTestId('hours-earnings-breakdown-total').props.children).toBe(
        '£216.12'
      );
    });

    it('renders an addition unsigned, as Intl formats it', () => {
      const { getByTestId } = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={adjustedEarnings(1500)}
          weekRangeLabel="3 Aug – 9 Aug"
        />
      );

      expect(
        getByTestId('hours-earnings-breakdown-line-adjustment-value').props
          .children
      ).toBe('£15.00');
    });

    it('forks the subline voice by role AND by sign', () => {
      const parentDeduction = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={adjustedEarnings(-2000)}
          weekRangeLabel="3 Aug – 9 Aug"
          earningsRole="parent"
        />
      );
      expect(
        parentDeduction.getByText('earningsLineAdjustmentDeductedParent')
      ).toBeTruthy();

      const nannyDeduction = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={adjustedEarnings(-2000)}
          weekRangeLabel="3 Aug – 9 Aug"
          earningsRole="nanny"
        />
      );
      expect(
        nannyDeduction.getByText('earningsLineAdjustmentDeductedNanny')
      ).toBeTruthy();
      expect(
        nannyDeduction.queryByText('earningsLineAdjustmentDeductedParent')
      ).toBeNull();

      const nannyAddition = render(
        <EarningsBreakdownSheet
          visible
          onDismiss={() => {}}
          earnings={adjustedEarnings(1500)}
          weekRangeLabel="3 Aug – 9 Aug"
          earningsRole="nanny"
        />
      );
      expect(
        nannyAddition.getByText('earningsLineAdjustmentAddedNanny')
      ).toBeTruthy();
    });
  });
});
