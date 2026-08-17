/**
 * @module components/custom/__tests__/InlineRetry.test
 *
 * The shared "we couldn't load this" line + retry button used everywhere a
 * failed or in-flight read must not render a fabricated fact (D-B1,
 * docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B).
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { InlineRetry } from '../InlineRetry';

describe('InlineRetry', () => {
  it('states the message and calls onRetry when pressed', () => {
    const onRetry = mock(() => {});
    const { getByTestId, getByText } = render(
      <InlineRetry
        testID="test-inline-retry"
        message="We couldn't load this."
        onRetry={onRetry}
      />
    );

    expect(getByText("We couldn't load this.")).toBeTruthy();
    fireEvent.press(getByTestId('test-inline-retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to a default testID when none is given', () => {
    const { getByTestId } = render(
      <InlineRetry message="Couldn't load." onRetry={() => {}} />
    );

    expect(getByTestId('inline-retry')).toBeTruthy();
  });
});
