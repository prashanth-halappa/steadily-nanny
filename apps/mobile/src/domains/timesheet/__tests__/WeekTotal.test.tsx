/**
 * @module domains/timesheet/__tests__/WeekTotal.test
 *
 * D15: previous/next week navigation lives on `WeekTotal` — it already
 * shows the week-range label, so the nav controls that change which week is
 * shown sit right next to it. No `AlertDialog`/`BottomSheetBase`/FlashList
 * here, so this renders cleanly under `@testing-library/react-native`,
 * unlike `HoursScreen`/`ParentWeekView` (see `HoursScreens.test.ts`'s
 * source-inspection rationale).
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { WeekTotal } from '../components/WeekTotal';

describe('WeekTotal', () => {
  it('renders the total and week range label without nav props (backwards compatible)', () => {
    const { getByTestId, queryByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
      />
    );

    expect(getByTestId('hours-week-total')).toBeTruthy();
    expect(getByTestId('hours-total')).toBeTruthy();
    expect(queryByTestId('hours-week-prev')).toBeNull();
    expect(queryByTestId('hours-week-next')).toBeNull();
  });

  it('renders previous/next controls when nav callbacks are provided, with a clear week-label testID', () => {
    const onPreviousWeek = mock(() => {});
    const onNextWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
        isNextDisabled={false}
      />
    );

    expect(getByTestId('hours-week-prev')).toBeTruthy();
    expect(getByTestId('hours-week-next')).toBeTruthy();
    expect(getByTestId('hours-week-label')).toBeTruthy();
  });

  it('tapping previous/next fires the respective callback', () => {
    const onPreviousWeek = mock(() => {});
    const onNextWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
        isNextDisabled={false}
      />
    );

    getByTestId('hours-week-prev').props.onPress?.();
    getByTestId('hours-week-next').props.onPress?.();

    expect(onPreviousWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  it('disables the next-week control when isNextDisabled is true — never lets navigation reach the future', () => {
    const onNextWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="0h 0m"
        overtimeLabel={null}
        onPreviousWeek={() => {}}
        onNextWeek={onNextWeek}
        isNextDisabled
      />
    );

    const nextButton = getByTestId('hours-week-next');
    expect(nextButton.props.disabled).toBe(true);
    expect(nextButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('disables the previous-week control when isPreviousDisabled is true — bounds how far back navigation can page', () => {
    const onPreviousWeek = mock(() => {});

    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="27 Jul – 2 Aug"
        totalLabel="0h 0m"
        overtimeLabel={null}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={() => {}}
        isPreviousDisabled
      />
    );

    const prevButton = getByTestId('hours-week-prev');
    expect(prevButton.props.disabled).toBe(true);
    expect(prevButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('does not render a money line when earnings is omitted (undefined)', () => {
    const { queryByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="9h 14m"
        overtimeLabel={null}
      />
    );
    expect(queryByTestId('hours-earnings-line')).toBeNull();
  });

  it('wires earnings through to WeekEarningsLine when earnings is provided', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="41h 0m"
        overtimeLabel={null}
        totalMinutes={2460}
        timesheetStatus="submitted"
        earningsRole="parent"
        earningsCarerId="carer-1"
        earnings={{
          status: 'ok',
          week_start: '2026-08-03',
          currency: 'GBP',
          lines: [],
          gross_minor: 23612,
          reimbursements_minor: 0,
          worked_minutes: 2460,
          payable_minutes: 2460,
          guaranteed_minutes_per_week: null,
        }}
      />
    );
    expect(getByTestId('hours-earnings-line')).toBeTruthy();
    expect(getByTestId('hours-earnings-line-amount').props.children).toBe(
      '£236.12'
    );
  });

  it('renders carer name and timesheet status pill above the total', () => {
    const { getByTestId } = render(
      <WeekTotal
        testID="hours-week-total"
        weekRangeLabel="3 Aug – 9 Aug"
        totalLabel="5h 34m"
        overtimeLabel={null}
        carerName="Maria Lopez"
        timesheetStatus="submitted"
        showPayBoundary
      />
    );

    expect(getByTestId('hours-carer-name')).toBeTruthy();
    expect(getByTestId('hours-timesheet-status')).toBeTruthy();
    expect(getByTestId('hours-pay-boundary')).toBeTruthy();
  });

  // Walkthrough fix 1: the reopen affordance was buried in the FlashList
  // footer, below the day rows and reimbursements card — invisible on
  // first load for an approved week. It now lives in the summary card
  // itself, next to the status pill and gross, so a parent who doubts an
  // approved total sees it immediately.
  describe('reopen affordance', () => {
    it('renders hours-reopen-button in the summary card on an approved week when onReopenPress is supplied', () => {
      const onReopenPress = mock(() => {});
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          onReopenPress={onReopenPress}
        />
      );

      const button = getByTestId('hours-reopen-button');
      expect(button).toBeTruthy();
      button.props.onPress?.();
      expect(onReopenPress).toHaveBeenCalledTimes(1);
    });

    it('gives the reopen control more visual weight than a plain ghost button, so it reads as distinct from Query', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          onReopenPress={() => {}}
        />
      );

      // "destructive" is the app's existing high-weight treatment for a
      // consequential action (settings-delete-account-confirm,
      // shift-detail's decline confirm) — a solid, tinted button, not the
      // quiet `ghost` variant Query still uses.
      expect(getByTestId('hours-reopen-button').props.variant).toBe(
        'destructive'
      );
    });

    it('does not render the reopen control when the week is not approved, even if a handler is supplied', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="submitted"
          onReopenPress={() => {}}
        />
      );

      expect(queryByTestId('hours-reopen-button')).toBeNull();
    });

    it('does not render the reopen control when no handler is supplied (helper/read-only view)', () => {
      const { queryByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
        />
      );

      expect(queryByTestId('hours-reopen-button')).toBeNull();
    });

    it('disables the reopen control while a reopen is already in flight', () => {
      const { getByTestId } = render(
        <WeekTotal
          testID="hours-week-total"
          weekRangeLabel="3 Aug – 9 Aug"
          totalLabel="41h 0m"
          overtimeLabel={null}
          timesheetStatus="approved"
          onReopenPress={() => {}}
          isReopenPending
        />
      );

      expect(getByTestId('hours-reopen-button').props.disabled).toBe(true);
    });
  });
});
