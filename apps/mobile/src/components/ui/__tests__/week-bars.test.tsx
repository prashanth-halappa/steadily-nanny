/**
 * @module components/ui/__tests__/week-bars
 *
 * WeekBars is a 7-bar minutes chart. Data stays in Postgres dow order
 * (0=Sunday); `weekStartsOn` only rotates display, matching WeekStrip.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { palette } from '~/lib/design-tokens/palette';
import { WeekBars } from '../week-bars';

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

function isInstance(
  node: ReactTestInstance | string
): node is ReactTestInstance {
  return typeof node !== 'string';
}

const WEEK: number[] = [0, 480, 0, 240, 480, 120, 0];

describe('WeekBars', () => {
  it('renders 7 bars', () => {
    const { getByTestId } = render(
      <WeekBars dayMinutes={WEEK} testID="week-bars" />
    );
    for (let day = 0; day <= 6; day++) {
      expect(getByTestId(`week-bars-bar-${day}`)).toBeTruthy();
    }
  });

  it('honours weekStartsOn', () => {
    const sundayFirst = render(
      <WeekBars dayMinutes={WEEK} weekStartsOn={0} testID="week-bars" />
    );
    const sundayCells = sundayFirst
      .getByTestId('week-bars')
      .children.filter(isInstance);
    expect(sundayCells[0]?.props.testID).toBe('week-bars-day-0');
    expect(sundayCells[1]?.props.testID).toBe('week-bars-day-1');

    const mondayFirst = render(
      <WeekBars dayMinutes={WEEK} testID="week-bars" />
    );
    const mondayCells = mondayFirst
      .getByTestId('week-bars')
      .children.filter(isInstance);
    expect(mondayCells[0]?.props.testID).toBe('week-bars-day-1');
    expect(mondayCells[mondayCells.length - 1]?.props.testID).toBe(
      'week-bars-day-0'
    );
  });

  it('a zero day still renders a visible stub', () => {
    const { getByTestId } = render(
      <WeekBars dayMinutes={WEEK} testID="week-bars" />
    );
    const zero = flattenStyle(getByTestId('week-bars-bar-0').props.style);
    const full = flattenStyle(getByTestId('week-bars-bar-1').props.style);
    expect(zero.height).toBeGreaterThan(0);
    expect(full.height).toBeGreaterThan(zero.height as number);
  });

  it("today's bar is emphasised differently from the rest", () => {
    const { getByTestId } = render(
      <WeekBars dayMinutes={WEEK} todayIndex={1} testID="week-bars" />
    );
    const today = flattenStyle(getByTestId('week-bars-bar-1').props.style);
    const other = flattenStyle(getByTestId('week-bars-bar-3').props.style);
    expect(today.backgroundColor).toBe(palette.light.primary.hex);
    expect(other.backgroundColor).not.toBe(today.backgroundColor);
  });

  it('has an accessibility label summarising the week', () => {
    const { getByTestId } = render(
      <WeekBars dayMinutes={WEEK} testID="week-bars" />
    );
    const label = getByTestId('week-bars').props.accessibilityLabel as string;
    expect(label.length).toBeGreaterThan(0);
    expect(label).toContain('480');
  });
});
