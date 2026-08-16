/**
 * ReceiptCard — calm confirmation surface. Positive card tone, hours chip,
 * and the receipt-tier haptic owned by useMilestone.
 *
 * @module components/ui/__tests__/receipt-card.test
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { Text, type ViewStyle } from 'react-native';
import { ReceiptCard } from '@/src/components/ui/receipt-card';
import { palette } from '~/lib/design-tokens/palette';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

const useMilestone = mock(() => ({
  easing: null,
  showConfetti: false,
}));

mock.module('@/lib/animations/useMilestone', () => ({
  useMilestone,
}));

/**
 * The elevation style object off a rendered Card.
 *
 * Read straight off the style array rather than via `StyleSheet.flatten` —
 * the react-native test double drops `boxShadow` when flattening.
 */
function elevationStyle(style: unknown): ViewStyle | undefined {
  const entries = Array.isArray(style) ? style : [style];
  return entries.find(
    (s): s is ViewStyle => Boolean(s) && 'boxShadow' in (s as object)
  );
}

function backgroundColor(style: unknown): string | undefined {
  const entries = Array.isArray(style) ? style : [style];
  const bg = entries.find(
    (s): s is ViewStyle => Boolean(s) && 'backgroundColor' in (s as object)
  );
  return bg?.backgroundColor as string | undefined;
}

describe('ReceiptCard', () => {
  beforeEach(() => {
    useMilestone.mockClear();
    useMilestone.mockReturnValue({ easing: null, showConfetti: false });
  });

  it('renders a Card with the positive tone', () => {
    const { getByTestId } = render(
      <ReceiptCard testID="receipt" receiptKey="receipt-1" title="Hours sent" />
    );
    const style = getByTestId('receipt').props.style;
    expect(backgroundColor(style)).toBe(palette.light.surfacePositive.hex);
    expect(elevationStyle(style)).toBeDefined();
  });

  it('calls useMilestone with the receipt tier and the given key', () => {
    render(
      <ReceiptCard
        testID="receipt"
        receiptKey="receipt-key"
        title="Hours sent"
      />
    );

    expect(useMilestone).toHaveBeenCalledWith('receipt', 'receipt-key');
  });

  it('renders the dots slot when provided', () => {
    const { getByText } = render(
      <ReceiptCard
        testID="receipt"
        receiptKey="receipt-dots"
        title="Hours sent"
        dots={<Text>dot-a</Text>}
      />
    );

    expect(getByText('dot-a')).toBeTruthy();
  });
});
