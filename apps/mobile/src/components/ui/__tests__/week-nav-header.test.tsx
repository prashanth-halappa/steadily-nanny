/**
 * @module components/ui/__tests__/week-nav-header.test
 * Shared week nav used by Hours and Schedule — keep controls identical.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { WeekNavHeader } from '../week-nav-header';

describe('WeekNavHeader', () => {
  it('renders label and fires previous/next callbacks', () => {
    const onPreviousWeek = mock(() => {});
    const onNextWeek = mock(() => {});

    const { getByTestId, getByText } = render(
      <WeekNavHeader
        label="3 Aug – 9 Aug"
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
        previousAccessibilityLabel="Previous week"
        nextAccessibilityLabel="Next week"
      />
    );

    expect(getByText('3 Aug – 9 Aug')).toBeTruthy();
    getByTestId('hours-week-prev').props.onPress?.();
    getByTestId('hours-week-next').props.onPress?.();
    expect(onPreviousWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  it('disables prev/next when flagged', () => {
    const { getByTestId } = render(
      <WeekNavHeader
        label="3 Aug – 9 Aug"
        onPreviousWeek={() => {}}
        onNextWeek={() => {}}
        previousAccessibilityLabel="Previous week"
        nextAccessibilityLabel="Next week"
        isPreviousDisabled
        isNextDisabled
        previousTestID="schedule-week-prev"
        nextTestID="schedule-week-next"
        labelTestID="schedule-week-label"
      />
    );

    expect(getByTestId('schedule-week-prev').props.disabled).toBe(true);
    expect(getByTestId('schedule-week-next').props.disabled).toBe(true);
  });
});
