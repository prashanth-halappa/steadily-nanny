/**
 * @module components/ui/__tests__/day-header
 *
 * DayHeader is the agenda day-section header, extracted so later streams
 * can share the same chrome. The two agenda testIDs are load-bearing.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { DayHeader } from '../day-header';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

describe('DayHeader', () => {
  it('renders the label', () => {
    const { getByText } = render(
      <DayHeader
        label="Monday, Aug 3"
        localDate="2026-08-03"
        isToday={false}
        totalMinutes={null}
      />
    );
    expect(getByText('Monday, Aug 3')).toBeTruthy();
  });

  it('renders the Today pill only when isToday', () => {
    const today = render(
      <DayHeader
        label="Monday, Aug 3"
        localDate="2026-08-03"
        isToday
        totalMinutes={null}
      />
    );
    expect(today.getByTestId('schedule-day-today-2026-08-03')).toBeTruthy();

    const other = render(
      <DayHeader
        label="Tuesday, Aug 4"
        localDate="2026-08-04"
        isToday={false}
        totalMinutes={null}
      />
    );
    expect(other.queryByTestId('schedule-day-today-2026-08-04')).toBeNull();
  });

  it('renders the total only when totalMinutes !== null', () => {
    const withTotal = render(
      <DayHeader
        label="Monday, Aug 3"
        localDate="2026-08-03"
        isToday={false}
        totalMinutes={480}
      />
    );
    const total = withTotal.getByTestId('schedule-day-total-2026-08-03');
    expect(total.props.children).toBe('8h');
    expect(flattenStyle(total.props.style).fontVariant).toEqual([
      'tabular-nums',
    ]);

    const without = render(
      <DayHeader
        label="Monday, Aug 3"
        localDate="2026-08-03"
        isToday={false}
        totalMinutes={null}
      />
    );
    expect(without.queryByTestId('schedule-day-total-2026-08-03')).toBeNull();
  });

  it("both testIDs match the agenda's existing ones", () => {
    const { getByTestId } = render(
      <DayHeader
        label="Monday, Aug 3"
        localDate="2026-08-03"
        isToday
        totalMinutes={0}
        testID="day-header"
      />
    );
    expect(getByTestId('schedule-day-today-2026-08-03')).toBeTruthy();
    expect(getByTestId('schedule-day-total-2026-08-03')).toBeTruthy();
    expect(getByTestId('day-header')).toBeTruthy();
  });
});
