/**
 * @module components/ui/__tests__/back-button
 * Shared "< Back" affordance — icon + label, a11y props, testID passthrough.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { BackButton } from '../back-button';

describe('BackButton', () => {
  it('renders the label and fires onPress', () => {
    const onPress = mock(() => {});
    const { getByTestId, getByText } = render(
      <BackButton testID="my-back" onPress={onPress} label="Back" />
    );

    expect(getByText('Back')).toBeTruthy();
    fireEvent.press(getByTestId('my-back'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('sets accessibility role and label to the given label', () => {
    const { getByTestId } = render(
      <BackButton testID="my-back" onPress={() => {}} label="Back" />
    );
    const pressable = getByTestId('my-back');
    expect(pressable.props.accessibilityRole).toBe('button');
    expect(pressable.props.accessibilityLabel).toBe('Back');
    expect(pressable.props.hitSlop).toBe(12);
  });

  it('renders without a testID when omitted', () => {
    const { getByText } = render(
      <BackButton onPress={() => {}} label="Back" />
    );
    expect(getByText('Back')).toBeTruthy();
  });
});
