/**
 * @module components/ui/__tests__/day-header
 *
 * DayHeader is the agenda day-section header, extracted so later streams
 * can share the same chrome. The two agenda testIDs are load-bearing.
 * The total is a pre-formatted string from the caller — `"0m"` still
 * renders; `null` means no total element at all.
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

const baseProps = {
  label: 'Monday, Aug 3',
  localDate: '2026-08-03',
  isToday: false,
} as const;

describe('DayHeader', () => {
  it('renders the label', () => {
    const { getByText } = render(<DayHeader {...baseProps} total={null} />);
    expect(getByText('Monday, Aug 3')).toBeTruthy();
  });

  it('renders the Today pill only when isToday', () => {
    const today = render(<DayHeader {...baseProps} isToday total={null} />);
    expect(today.getByTestId('schedule-day-today-2026-08-03')).toBeTruthy();

    const other = render(
      <DayHeader
        label="Tuesday, Aug 4"
        localDate="2026-08-04"
        isToday={false}
        total={null}
      />
    );
    expect(other.queryByTestId('schedule-day-today-2026-08-04')).toBeNull();
  });

  it('renders a pre-formatted total string as-is', () => {
    const { getByTestId } = render(<DayHeader {...baseProps} total="8h" />);
    const total = getByTestId('schedule-day-total-2026-08-03');
    expect(total.props.children).toBe('8h');
    expect(flattenStyle(total.props.style).fontVariant).toEqual([
      'tabular-nums',
    ]);
  });

  it('renders a zero total ("0m") — a real "no cover" figure', () => {
    const { getByTestId } = render(<DayHeader {...baseProps} total="0m" />);
    expect(getByTestId('schedule-day-total-2026-08-03').props.children).toBe(
      '0m'
    );
  });

  it('renders no total element at all when total is null', () => {
    const { queryByTestId } = render(<DayHeader {...baseProps} total={null} />);
    expect(queryByTestId('schedule-day-total-2026-08-03')).toBeNull();
  });

  it("both testIDs match the agenda's existing ones", () => {
    const { getByTestId } = render(
      <DayHeader {...baseProps} isToday total="0m" testID="day-header" />
    );
    expect(getByTestId('schedule-day-today-2026-08-03')).toBeTruthy();
    expect(getByTestId('schedule-day-total-2026-08-03')).toBeTruthy();
    expect(getByTestId('day-header')).toBeTruthy();
  });
});
