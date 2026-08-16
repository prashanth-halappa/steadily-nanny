/**
 * @module components/ui/__tests__/split-track
 *
 * SplitTrack is a colour-agnostic proportion bar. It never picks a hue;
 * a zero total is absence, not a empty track.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { SplitTrack } from '../split-track';

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

describe('SplitTrack', () => {
  it('segment flex is proportional to value', () => {
    const { getByTestId } = render(
      <SplitTrack
        testID="split"
        segments={[
          { value: 2, colour: '#111111', testID: 'seg-a' },
          { value: 1, colour: '#222222', testID: 'seg-b' },
        ]}
      />
    );
    expect(flattenStyle(getByTestId('seg-a').props.style).flex).toBe(2);
    expect(flattenStyle(getByTestId('seg-b').props.style).flex).toBe(1);
  });

  it('renders nothing at zero total', () => {
    const { queryByTestId } = render(
      <SplitTrack
        testID="split"
        segments={[
          { value: 0, colour: '#111111', testID: 'seg-a' },
          { value: 0, colour: '#222222', testID: 'seg-b' },
        ]}
      />
    );
    expect(queryByTestId('split')).toBeNull();
    expect(queryByTestId('seg-a')).toBeNull();
  });

  it("uses the caller's colours", () => {
    const { getByTestId } = render(
      <SplitTrack
        testID="split"
        segments={[
          { value: 3, colour: '#6A4C77', testID: 'seg-a' },
          { value: 1, colour: '#4C7A6A', testID: 'seg-b' },
        ]}
      />
    );
    expect(flattenStyle(getByTestId('seg-a').props.style).backgroundColor).toBe(
      '#6A4C77'
    );
    expect(flattenStyle(getByTestId('seg-b').props.style).backgroundColor).toBe(
      '#4C7A6A'
    );
  });
});
