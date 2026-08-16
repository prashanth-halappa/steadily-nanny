/**
 * @module components/ui/__tests__/now-line
 *
 * NowLine is a static "you are here" marker. No timer, no ticking clock.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NowLine } from '../now-line';

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

describe('NowLine', () => {
  it('renders the dot, the rule and the label', () => {
    const { getByTestId, getByText } = render(
      <NowLine label="2:30pm" testID="now-line" />
    );
    expect(getByTestId('now-line-dot')).toBeTruthy();
    expect(getByTestId('now-line-rule')).toBeTruthy();
    expect(getByText('2:30pm')).toBeTruthy();
    expect(flattenStyle(getByTestId('now-line-rule').props.style).height).toBe(
      StyleSheet.hairlineWidth
    );
  });

  it('the label is tabular', () => {
    const { getByText } = render(<NowLine label="2:30pm" testID="now-line" />);
    const style = flattenStyle(getByText('2:30pm').props.style);
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });
});
