/**
 * @module domains/timesheet/__tests__/PaymentsEntryRow.test
 *
 * `hours-payments-link` used to be a bare `Pressable` wrapping a `Small` —
 * no `accessibilityRole`, so VoiceOver announced it as static text, and a
 * ~14pt hit area against the repo's 44pt floor. This is the row that
 * replaces it; see `PendingExpensesRow` for the geometry it copies.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { PaymentsEntryRow } from '../components/PaymentsEntryRow';

describe('PaymentsEntryRow', () => {
  it('renders with the default testID', () => {
    const { getByTestId } = render(
      <PaymentsEntryRow subtitle="payments.subtitleParent" onPress={() => {}} />
    );

    expect(getByTestId('hours-payments-link')).toBeTruthy();
  });

  it('exposes accessibilityRole="button" — the regression this row fixes', () => {
    const { getByTestId } = render(
      <PaymentsEntryRow subtitle="payments.subtitleParent" onPress={() => {}} />
    );

    expect(getByTestId('hours-payments-link').props.accessibilityRole).toBe(
      'button'
    );
  });

  it('exposes the accessibilityLabel', () => {
    const { getByTestId } = render(
      <PaymentsEntryRow subtitle="payments.subtitleParent" onPress={() => {}} />
    );

    expect(getByTestId('hours-payments-link').props.accessibilityLabel).toBe(
      'payments.entryLink'
    );
  });

  it('renders the headline and the passed subtitle', () => {
    const { getByText, getByTestId } = render(
      <PaymentsEntryRow subtitle="payments.subtitleParent" onPress={() => {}} />
    );

    expect(getByText('payments.screenTitle')).toBeTruthy();
    expect(getByTestId('hours-payments-link-subtitle').props.children).toBe(
      'payments.subtitleParent'
    );
  });

  it('fires onPress on press', () => {
    const onPress = mock(() => {});
    const { getByTestId } = render(
      <PaymentsEntryRow subtitle="payments.subtitleParent" onPress={onPress} />
    );

    fireEvent.press(getByTestId('hours-payments-link'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lets a custom testID override the default and flows to the subtitle child', () => {
    const { getByTestId } = render(
      <PaymentsEntryRow
        subtitle="payments.subtitleNanny"
        onPress={() => {}}
        testID="custom-payments-row"
      />
    );

    expect(getByTestId('custom-payments-row')).toBeTruthy();
    expect(getByTestId('custom-payments-row-subtitle').props.children).toBe(
      'payments.subtitleNanny'
    );
  });

  it('is the outermost node — the Pressable itself carries the default testID', () => {
    const { getByTestId } = render(
      <PaymentsEntryRow subtitle="payments.subtitleParent" onPress={() => {}} />
    );

    // If a wrapper View were outermost, `type` would be 'View', not the
    // Pressable's underlying native type.
    expect(getByTestId('hours-payments-link').type).not.toBe('View');
  });
});
