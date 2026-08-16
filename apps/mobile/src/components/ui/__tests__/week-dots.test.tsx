/**
 * @module components/ui/__tests__/week-dots
 *
 * WeekDots is a 7-dot presence row. `worked` is Postgres dow-indexed;
 * `weekStartsOn` only rotates display, matching WeekStrip.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { palette } from '~/lib/design-tokens/palette';
import { WeekDots } from '../week-dots';

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

describe('WeekDots', () => {
  it('renders 7 dots', () => {
    const { getByTestId } = render(
      <WeekDots
        worked={[false, true, false, false, false, false, false]}
        testID="week-dots"
      />
    );
    for (let day = 0; day <= 6; day++) {
      expect(getByTestId(`week-dots-dot-${day}`)).toBeTruthy();
    }
  });

  it('fills exactly the worked days', () => {
    const { getByTestId } = render(
      <WeekDots
        worked={[false, true, false, true, false, false, false]}
        testID="week-dots"
      />
    );
    const filled = palette.light.primary.hex;
    expect(
      flattenStyle(getByTestId('week-dots-dot-1').props.style).backgroundColor
    ).toBe(filled);
    expect(
      flattenStyle(getByTestId('week-dots-dot-3').props.style).backgroundColor
    ).toBe(filled);
    expect(
      flattenStyle(getByTestId('week-dots-dot-0').props.style).backgroundColor
    ).not.toBe(filled);
    expect(
      flattenStyle(getByTestId('week-dots-dot-2').props.style).backgroundColor
    ).not.toBe(filled);
  });

  it('honours weekStartsOn', () => {
    const sundayFirst = render(
      <WeekDots
        worked={[true, false, false, false, false, false, false]}
        weekStartsOn={0}
        testID="week-dots"
      />
    );
    const sundayDots = sundayFirst
      .getByTestId('week-dots')
      .children.filter(isInstance);
    expect(sundayDots[0]?.props.testID).toBe('week-dots-dot-0');
    expect(sundayDots[1]?.props.testID).toBe('week-dots-dot-1');

    const mondayFirst = render(
      <WeekDots
        worked={[true, false, false, false, false, false, false]}
        testID="week-dots"
      />
    );
    const mondayDots = mondayFirst
      .getByTestId('week-dots')
      .children.filter(isInstance);
    expect(mondayDots[0]?.props.testID).toBe('week-dots-dot-1');
    expect(mondayDots[mondayDots.length - 1]?.props.testID).toBe(
      'week-dots-dot-0'
    );
  });
});
