/**
 * @module ChildChipTests
 *
 * TDD tests for ChildChip. Load-bearing case: with no `onPress`, the chip
 * must render as a non-interactive plain View — no press affordance, no
 * haptic — never an AnimatedPressable.
 */

import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { ChildChip } from '../child-chip';

describe('ChildChip', () => {
  it('renders the child name', () => {
    const { getByText } = render(<ChildChip name="Wren" testID="chip-wren" />);
    expect(getByText('Wren')).toBeTruthy();
  });

  it('renders as a non-interactive View when onPress is absent', () => {
    const { getByTestId } = render(
      <ChildChip name="Wren" testID="chip-wren" />
    );
    const chip = getByTestId('chip-wren');
    expect(String(chip.type)).toBe('View');
    expect(chip.props.onPress).toBeUndefined();
  });

  it('renders as an AnimatedPressable when onPress is provided', () => {
    const onPress = mock(() => {});
    const { getByTestId } = render(
      <ChildChip name="Wren" onPress={onPress} testID="chip-wren" />
    );
    expect(String(getByTestId('chip-wren').type)).toBe('AnimatedPressable');
  });

  it('fires onPress when tapped', () => {
    const onPress = mock(() => {});
    const { getByTestId } = render(
      <ChildChip name="Wren" onPress={onPress} testID="chip-wren" />
    );
    fireEvent.press(getByTestId('chip-wren'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('applies the selected background when selected', () => {
    const { getByTestId } = render(
      <ChildChip name="Wren" selected testID="chip-wren-selected" />
    );
    expect(getByTestId('chip-wren-selected').props.className).toContain(
      'bg-primary'
    );
  });

  it('applies a caller-provided colour dot as an inline style', () => {
    const { getByTestId } = render(
      <ChildChip name="Wren" colour="#14B8A6" testID="chip-wren-colour" />
    );
    const dot = getByTestId('chip-wren-colour-dot');
    // Legacy brand swatches remap to Daylight category accents
    expect(dot.props.style).toEqual(
      expect.objectContaining({ backgroundColor: '#4C7A6A' })
    );
  });
});
