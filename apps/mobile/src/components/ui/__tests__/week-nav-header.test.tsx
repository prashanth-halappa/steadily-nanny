/**
 * @module components/ui/__tests__/week-nav-header.test
 * Shared week nav used by Hours and Schedule — keep controls identical.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { WeekNavHeader } from '../week-nav-header';

function flatStyle(node: { props: { style?: unknown } }) {
  const style = node.props.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : (style ?? {});
}

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

  it('renders the label at semibold default-foreground weight', () => {
    const { getByTestId } = render(
      <WeekNavHeader
        label="3 Aug – 9 Aug"
        onPreviousWeek={() => {}}
        onNextWeek={() => {}}
        previousAccessibilityLabel="Previous week"
        nextAccessibilityLabel="Next week"
      />
    );

    const label = getByTestId('hours-week-label');
    expect(flatStyle(label).fontWeight).toBe('600');
    expect(label.props.className).not.toContain('text-muted-foreground');
  });
});
