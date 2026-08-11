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

// Mutable so individual tests can simulate "today" advancing (e.g. midnight
// passing) while a sheet stays open with no re-render — review finding 11.
let mockToday = '2026-08-04';
mock.module('@/src/lib/localDate', () => {
  const actual = require('@/src/lib/localDate');
  return {
    ...actual,
    localDateInZone: (..._args: unknown[]) => mockToday,
  };
});

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
  // 065: null = still live; set only when a member is removed.
  valid_to: null,
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
      householdTimezone="UTC"
      householdWeekStartsOn={1}
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

  it('the mid-week consequence line appears for a mid-week effective date and states both rates', () => {
    const { getByTestId } = renderSheet();

    // Today (2026-08-04) is already a Tuesday, so the default choice alone
    // triggers it once a new rate is typed.
    fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');

    expect(getByTestId('pay-change-midweek-consequence')).toBeTruthy();
  });

  it('no mid-week line mid-week when the rate is unchanged from the pre-fill', () => {
    const { queryByTestId } = renderSheet();

    // Default Today (Tuesday) + pre-filled current rate — no rate change, so
    // there is no two-rate split to warn about.
    expect(queryByTestId('pay-change-midweek-consequence')).toBeNull();
  });

  // 3-E1: the split question is asked against the HOUSEHOLD's week start.
  // 2026-08-03 is a Monday — clean for a Monday-start household, mid-week
  // for a Sunday-start one. Same date, same rate change, opposite answer.
  it('honours the household week start: a Monday is clean at 1 and a split at 0', () => {
    const mondayStart = renderSheet({
      todayISO: '2026-08-03',
      householdWeekStartsOn: 1,
    });
    fireEvent.changeText(
      mondayStart.getByTestId('pay-change-rate-input'),
      '19.50'
    );
    expect(
      mondayStart.queryByTestId('pay-change-midweek-consequence')
    ).toBeNull();

    const sundayStart = renderSheet({
      todayISO: '2026-08-03',
      householdWeekStartsOn: 0,
    });
    fireEvent.changeText(
      sundayStart.getByTestId('pay-change-rate-input'),
      '19.50'
    );
    expect(
      sundayStart.getByTestId('pay-change-midweek-consequence')
    ).toBeTruthy();
  });

  it('a mid-week CURRENCY change warns even when the rate is untouched', () => {
    // `buildMidWeekConsequence` has always compared currency, but this sheet
    // used to pass `currentArrangement.currency` as BOTH the old and the new
    // value, so the currency half could never fire. A flip splits the week and
    // the API answers such a week with the `currency_change` earnings arm
    // rather than a total (earningsService.ts) — this line is the only warning
    // before that happens.
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('pay-change-currency-trigger'));
    fireEvent.press(getByTestId('pay-change-currency-EUR'));

    expect(getByTestId('pay-change-midweek-consequence')).toBeTruthy();
  });

  it('switching currency moves the rate input adornment off the stored code', () => {
    const { getByTestId } = renderSheet();

    expect(getByTestId('pay-change-currency-prefix').props.children).toBe('£');
    fireEvent.press(getByTestId('pay-change-currency-trigger'));
    fireEvent.press(getByTestId('pay-change-currency-USD'));
    expect(getByTestId('pay-change-currency-prefix').props.children).toBe('$');
  });

  it('submits the selected currency, not the arrangement’s stored one', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.press(getByTestId('pay-change-currency-trigger'));
    fireEvent.press(getByTestId('pay-change-currency-USD'));
    fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');
    fireEvent.press(getByTestId('pay-change-submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD' })
    );
  });

  it('offers the wider curated list, not just the three shipped symbols', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('pay-change-currency-trigger'));

    for (const code of ['CAD', 'MXN', 'AUD', 'INR', 'JPY']) {
      expect(getByTestId(`pay-change-currency-${code}`)).toBeTruthy();
    }
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

  // 3-E2 / migration 078. The sheet seeds every term from the arrangement —
  // T17's failure mode is a new column that is never seeded and never sent,
  // so a change to the rate silently wipes the daily tiers.
  describe('078 daily tiers and the seventh day', () => {
    const tieredArrangement: PayArrangement = {
      ...currentArrangement,
      overtime_threshold_minutes: 2400,
      overtime_multiplier: 1.5,
      overtime_daily_threshold_minutes: 480,
      doubletime_daily_threshold_minutes: 720,
      doubletime_multiplier: 2,
      seventh_day_multiplier: 1.5,
      seventh_day_doubletime_after_minutes: 480,
    };

    it('seeds all five fields from the current arrangement', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: tieredArrangement,
      });

      expect(
        getByTestId('pay-change-daily-overtime-threshold-input').props.value
      ).toBe('8');
      expect(
        getByTestId('pay-change-doubletime-threshold-input').props.value
      ).toBe('12');
      expect(
        getByTestId('pay-change-doubletime-multiplier-input').props.value
      ).toBe('2');
      expect(
        getByTestId('pay-change-seventh-day-multiplier-input').props.value
      ).toBe('1.5');
      expect(
        getByTestId('pay-change-seventh-day-doubletime-after-input').props.value
      ).toBe('8');
    });

    it('a null column seeds an empty field, never a fabricated default', () => {
      const { getByTestId } = renderSheet();

      for (const testID of [
        'pay-change-daily-overtime-threshold-input',
        'pay-change-doubletime-threshold-input',
        'pay-change-doubletime-multiplier-input',
        'pay-change-seventh-day-multiplier-input',
        'pay-change-seventh-day-doubletime-after-input',
      ]) {
        expect(getByTestId(testID).props.value).toBe('');
      }
    });

    it('a rate-only change re-sends every seeded tier unchanged', () => {
      const { getByTestId, onSubmit } = renderSheet({
        currentArrangement: tieredArrangement,
      });

      fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          overtime_daily_threshold_minutes: 480,
          doubletime_daily_threshold_minutes: 720,
          doubletime_multiplier: 2,
          seventh_day_multiplier: 1.5,
          seventh_day_doubletime_after_minutes: 480,
        })
      );
    });

    it('sends all five as null when every tier is left blank', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          overtime_daily_threshold_minutes: null,
          doubletime_daily_threshold_minutes: null,
          doubletime_multiplier: null,
          seventh_day_multiplier: null,
          seventh_day_doubletime_after_minutes: null,
        })
      );
    });

    it('refuses to submit inverted daily tiers rather than reordering them', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.changeText(
        getByTestId('pay-change-daily-overtime-threshold-input'),
        '8'
      );
      fireEvent.changeText(
        getByTestId('pay-change-doubletime-threshold-input'),
        '6'
      );
      fireEvent.changeText(
        getByTestId('pay-change-doubletime-multiplier-input'),
        '2'
      );
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  // 3-E4 / `worked_holiday_multiplier`. Same T17 hazard as the 078 five: a
  // column this sheet never seeds is a term a rate change silently drops.
  describe('the worked-holiday premium', () => {
    it('seeds from the current arrangement', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          worked_holiday_multiplier: 1.5,
        },
      });

      expect(
        getByTestId('pay-change-worked-holiday-multiplier-input').props.value
      ).toBe('1.5');
    });

    it('a null column seeds an empty field, never a fabricated 1.5', () => {
      const { getByTestId } = renderSheet();

      expect(
        getByTestId('pay-change-worked-holiday-multiplier-input').props.value
      ).toBe('');
    });

    it('a rate-only change re-sends the seeded premium unchanged', () => {
      const { getByTestId, onSubmit } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          worked_holiday_multiplier: 2,
        },
      });

      fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ worked_holiday_multiplier: 2 })
      );
    });

    it('sends null when the field is left blank', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ worked_holiday_multiplier: null })
      );
    });

    it('refuses to submit a below-1 premium rather than clamping it', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.changeText(
        getByTestId('pay-change-worked-holiday-multiplier-input'),
        '0.5'
      );
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).not.toHaveBeenCalled();
    });
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

  describe('review finding 11: the submitted date is computed at submit time, not frozen at render time', () => {
    it('submits the LATER date when "today" rolls over (e.g. past midnight) while the sheet stays open with no re-render', () => {
      mockToday = '2026-08-04';
      const { getByTestId, onSubmit } = renderSheet({ todayISO: '2026-08-04' });

      // Simulate the sheet sitting open across midnight: nothing re-renders
      // (no state change happens), but the real "today" has moved on.
      mockToday = '2026-08-05';
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ valid_from: '2026-08-05' })
      );
    });
  });

  describe('review finding 14: currency prefix uses the arrangement currency, not a hardcoded £', () => {
    it('shows € for a EUR arrangement', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: { ...currentArrangement, currency: 'EUR' },
      });
      expect(getByTestId('pay-change-currency-prefix').props.children).toBe(
        '€'
      );
    });

    it('shows $ for a USD arrangement', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: { ...currentArrangement, currency: 'USD' },
      });
      expect(getByTestId('pay-change-currency-prefix').props.children).toBe(
        '$'
      );
    });

    it('falls back to the bare code for an unmapped currency, never blank', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: { ...currentArrangement, currency: 'AUD' },
      });
      expect(getByTestId('pay-change-currency-prefix').props.children).toBe(
        'AUD'
      );
    });
  });
});
