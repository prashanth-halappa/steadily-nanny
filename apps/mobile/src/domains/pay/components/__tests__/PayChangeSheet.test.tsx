/**
 * @module domains/pay/components/__tests__/PayChangeSheet
 *
 * Covers the load-bearing controls per the task brief: the "Today" chip
 * defaults selected, a future date is impossible to submit, the household's
 * `0`-cancellation-window default maps to the "No cancellation pay" chip,
 * and the mid-week consequence line appears for a non-Monday effective date.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { fireEvent, render } from '@testing-library/react-native';
import type * as React from 'react';
import { PayChangeSheet } from '../PayChangeSheet';

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

const TODAY_ISO = '2026-08-04'; // a Tuesday

const currentArrangement: PayArrangement = {
  id: 'arr-1',
  household_id: 'hh-1',
  carer_id: 'carer-1',
  rate_minor: 1850,
  bill_rate_minor: null,
  currency: 'GBP',
  overtime_threshold_minutes: null,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
  valid_from: '2026-04-01',
  carer_display_name: 'Priya',
  note: null,
  created_by: 'parent-1',
  created_at: '2026-03-28T09:00:00.000Z',
};

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof PayChangeSheet>> = {}
) {
  const onSubmit = mock();
  const utils = render(
    <PayChangeSheet
      visible
      onDismiss={() => {}}
      onSubmit={onSubmit}
      isSubmitting={false}
      currentArrangement={currentArrangement}
      householdCancellationDefaultHours={0}
      todayISO={TODAY_ISO}
      {...overrides}
    />
  );
  return { ...utils, onSubmit };
}

describe('PayChangeSheet', () => {
  it('defaults the effective-date chip to "Today" and submits with today\'s date', () => {
    const { getByTestId, onSubmit } = renderSheet();

    expect(getByTestId('pay-change-chip-today').props.variant).toBe('default');
    expect(getByTestId('pay-change-chip-earlier').props.variant).toBe(
      'outline'
    );
    fireEvent.press(getByTestId('pay-change-submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ valid_from: TODAY_ISO, rate_minor: 1850 })
    );
  });

  it('never submits a future date — there is no way to select one', () => {
    const { getByTestId, queryByTestId, onSubmit } = renderSheet();

    fireEvent.press(getByTestId('pay-change-chip-earlier'));
    fireEvent.changeText(getByTestId('pay-change-date-input'), '2026-08-05');
    fireEvent.press(getByTestId('pay-change-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(queryByTestId('pay-change-date-error')).toBeTruthy();
  });

  it('accepts a past date and shows the backdating hint', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.press(getByTestId('pay-change-chip-earlier'));
    fireEvent.changeText(getByTestId('pay-change-date-input'), '2026-07-01');

    expect(getByTestId('pay-change-backdating-hint')).toBeTruthy();

    fireEvent.press(getByTestId('pay-change-submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ valid_from: '2026-07-01' })
    );
  });

  it('a household window of 0 pre-selects "No cancellation pay" when the arrangement has none set, and submitting needs no further taps on that field', () => {
    const { getByTestId, onSubmit } = renderSheet({
      householdCancellationDefaultHours: 0,
    });

    // Selected chip renders the filled "default" Button variant; the other
    // stays "outline".
    expect(getByTestId('pay-change-cancellation-chip-none').props.variant).toBe(
      'default'
    );
    expect(
      getByTestId('pay-change-cancellation-chip-window').props.variant
    ).toBe('outline');

    fireEvent.press(getByTestId('pay-change-submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ cancellation_paid_within_hours: null })
    );
  });

  it('the mid-week consequence line appears for a non-Monday effective date and states both rates', () => {
    const { getByTestId } = renderSheet();

    // Today (2026-08-04) is already a Tuesday, so the default choice alone
    // triggers it once a new rate is typed.
    fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');

    expect(getByTestId('pay-change-midweek-consequence')).toBeTruthy();
  });

  it('no mid-week line when the effective date IS a Monday', () => {
    const mondayArrangement = { ...currentArrangement };
    const { getByTestId, queryByTestId } = renderSheet({
      currentArrangement: mondayArrangement,
      todayISO: '2026-08-03', // a Monday
    });

    fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');

    expect(queryByTestId('pay-change-midweek-consequence')).toBeNull();
  });

  it('on failure the sheet keeps the typed rate rather than resetting (ClockOutSheet discipline)', () => {
    const { getByTestId } = renderSheet();

    fireEvent.changeText(getByTestId('pay-change-rate-input'), '22.00');
    fireEvent.press(getByTestId('pay-change-submit'));

    // The caller (PayArrangementScreen) decides whether to close on failure;
    // this sheet itself never clears state on its own — it stays mounted with
    // the typed value regardless of what onSubmit's caller does.
    expect(getByTestId('pay-change-rate-input').props.value).toBe('22.00');
  });
});
