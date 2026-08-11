/**
 * @module components/custom/__tests__/RestrictedActionButton.test
 *
 * S4 (`docs/design/attention-and-notifications.md` §7): disabled with a
 * reason, never hidden — a hidden button is indistinguishable from a bug.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { RestrictedActionButton } from '../RestrictedActionButton';

const REASON = 'Only David can approve hours in this household.';

describe('RestrictedActionButton', () => {
  it('acts normally when there is no restriction', () => {
    const onPress = mock();
    const { getByTestId, queryByTestId } = render(
      <RestrictedActionButton
        testID="approve"
        label="Approve the week"
        reason={null}
        onPress={onPress}
      />
    );

    fireEvent.press(getByTestId('approve'));

    expect(onPress).toHaveBeenCalled();
    expect(queryByTestId('approve-reason')).toBeNull();
    expect(getByTestId('approve').props.accessibilityHint).toBeUndefined();
  });

  // `AnimatedPressable` is a bare host string in tests (bun.setup), so a
  // press fires regardless of `disabled` — the prop IS the contract here;
  // honouring it is React Native's job, not this component's.
  it('stays VISIBLE and disabled, with the reason beneath it, when restricted', () => {
    const { getByTestId } = render(
      <RestrictedActionButton
        testID="approve"
        label="Approve the week"
        reason={REASON}
        onPress={mock()}
      />
    );

    // Never hidden.
    expect(getByTestId('approve')).toBeTruthy();
    expect(getByTestId('approve').props.disabled).toBe(true);
    expect(getByTestId('approve-reason').props.children).toBe(REASON);
  });

  it('carries the reason as the button’s accessibilityHint for screen readers', () => {
    const { getByTestId } = render(
      <RestrictedActionButton
        testID="approve"
        label="Approve the week"
        reason={REASON}
        onPress={mock()}
      />
    );

    const button = getByTestId('approve');
    expect(button.props.accessibilityHint).toBe(REASON);
    // Still an announced, focusable control — a disabled button the reader
    // skips over teaches nobody anything.
    expect(button.props.accessibilityElementsHidden).toBeFalsy();
    expect(button.props.importantForAccessibility).not.toBe('no');
  });

  it('an unrestricted button can still be disabled for its own reasons (in flight)', () => {
    const { getByTestId, queryByTestId } = render(
      <RestrictedActionButton
        testID="approve"
        label="Approve the week"
        reason={null}
        disabled
        onPress={mock()}
      />
    );

    expect(getByTestId('approve').props.disabled).toBe(true);
    // Disabled for a passing reason is not a restriction — no sentence.
    expect(queryByTestId('approve-reason')).toBeNull();
  });
});
