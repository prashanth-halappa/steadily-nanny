/**
 * @module components/ui/__tests__/inline-error
 * Daylight #27 — errorInline tokens must reach the screen, not just the palette.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { InlineError } from '@/src/components/ui/inline-error';
import { palette } from '~/lib/design-tokens/palette';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

describe('InlineError', () => {
  it('renders the message with errorInline background, border, and text colours', () => {
    const { getByTestId, getByText } = render(
      <InlineError testID="auth-error" message="Invalid login credentials" />
    );
    expect(getByText('Invalid login credentials')).toBeTruthy();

    const style = getByTestId('auth-error').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flat.backgroundColor).toBe(palette.light.errorInlineBg.hex);
    expect(flat.borderColor).toBe(palette.light.errorInlineBorder.hex);
  });

  it('renders nothing when message is empty', () => {
    const { queryByTestId } = render(
      <InlineError testID="auth-error" message="" />
    );
    expect(queryByTestId('auth-error')).toBeNull();
  });
});
