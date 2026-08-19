/**
 * @module domains/pay/components/__tests__/AmountRow
 *
 * "Not set" vs "No cancellation pay" arms (TIER0-CX-SPEC.md §2) — the
 * distinction that keeps a null term from ever reading as an error.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { AmountRow } from '../AmountRow';

describe('AmountRow', () => {
  it('renders a set value', () => {
    const { getByTestId } = render(
      <AmountRow
        testID="row-overtime"
        label="Overtime"
        value="After 40h, at 1.5×"
      />
    );
    expect(getByTestId('row-overtime-value').props.children).toBe(
      'After 40h, at 1.5×'
    );
  });

  it('a null value with no override renders the default "Not set" copy', () => {
    const { getByTestId } = render(
      <AmountRow testID="row-mileage" label="Mileage" value={null} />
    );
    // Global react-i18next mock echoes the key.
    expect(getByTestId('row-mileage-value').props.children).toBe('notSet');
  });

  it('a null cancellations value renders its own override, never "Not set"', () => {
    const { getByTestId } = render(
      <AmountRow
        testID="row-cancellations"
        label="Cancellations"
        value={null}
        valueWhenNull="No cancellation pay"
      />
    );
    expect(getByTestId('row-cancellations-value').props.children).toBe(
      'No cancellation pay'
    );
  });

  it('renders an optional derivation sub-line', () => {
    const { getByText } = render(
      <AmountRow
        label="Hours worked"
        value="£236.12"
        subLine="12h 30m at £18.50"
      />
    );
    expect(getByText('12h 30m at £18.50')).toBeTruthy();
  });

  // §11.2: the only pressable label in the app — a dotted underline is the
  // whole affordance, so both arms (with/without a handler) need a test.
  it('a label with onLabelPress is pressable and fires', () => {
    const onLabelPress = mock(() => {});
    const { getByTestId } = render(
      <AmountRow
        testID="row-overtime"
        label="Overtime"
        value="After 40h, at 1.5×"
        onLabelPress={onLabelPress}
      />
    );
    fireEvent.press(getByTestId('row-overtime-label'));
    expect(onLabelPress).toHaveBeenCalledTimes(1);
  });

  it('a label without onLabelPress renders no press affordance', () => {
    const { queryByTestId } = render(
      <AmountRow testID="row-mileage" label="Mileage" value="£0.50/mi" />
    );
    expect(queryByTestId('row-mileage-label')).toBeNull();
  });
});
