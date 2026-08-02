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
});
