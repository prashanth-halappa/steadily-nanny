/**
 * @module components/ui/__tests__/input.focus
 * Daylight #25 — native focus ring + error variant (web: focus rings are no-ops on device).
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { Input } from '@/src/components/ui/input';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

describe('Input focus and error', () => {
  it('exposes an error prop that applies error-inline border treatment', () => {
    const { getByTestId } = render(
      <Input
        testID="field"
        accessibilityLabel="Email"
        error
        value=""
        onChangeText={() => {}}
      />
    );
    const className = getByTestId('field').props.className as string;
    expect(className).toMatch(/border-destructive|error/i);
  });

  it('applies a native focus border when focused (not web:-only)', () => {
    const { getByTestId } = render(
      <Input
        testID="field"
        accessibilityLabel="Email"
        value=""
        onChangeText={() => {}}
      />
    );
    const input = getByTestId('field');
    fireEvent(input, 'focus');
    const className = input.props.className as string;
    // After focus, border-ring (or equivalent) must be present for native.
    expect(className).toContain('border-ring');
  });

  it('drops the focus ring on blur', () => {
    const { getByTestId } = render(
      <Input
        testID="field"
        accessibilityLabel="Email"
        value=""
        onChangeText={() => {}}
      />
    );
    const input = getByTestId('field');
    fireEvent(input, 'focus');
    fireEvent(input, 'blur');
    const className = input.props.className as string;
    expect(className).not.toContain('border-ring');
  });
});
