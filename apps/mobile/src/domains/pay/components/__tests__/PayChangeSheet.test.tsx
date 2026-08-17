/**
 * @module domains/pay/components/__tests__/PayChangeSheet
 *
 * Covers the load-bearing controls per the task brief: the single date field
 * defaults to today and accepts a SCHEDULED future date (D-16) up to the
 * 12-month horizon, the household's `0`-cancellation-window default maps to
 * the "No cancellation pay" chip, and §7.3's consequence card lists a
 * sentence per changed term for a non-week-start effective date.
 *
 * Every optional term now lives inside a `TermGroup` (D-3), so a test that
 * touches one opens its group first — a closed group renders no children at
 * all, which is the point of §4.2.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { fireEvent, render } from '@testing-library/react-native';
import type * as React from 'react';
import enHousehold from '@/src/i18n/locales/en/household.json';
import enPay from '@/src/i18n/locales/en/pay.json';
import esPay from '@/src/i18n/locales/es/pay.json';
import { useAuthStore } from '@/src/store/auth';
import { offerRequestToArrangementStub } from '../../utils/payArrangementForm';
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
// §5.2's `terms.preset.confirmed_by` — the parent who ticked the box.
const PARENT_USER_ID = 'parent-1';

beforeEach(() => {
  mockToday = TODAY_ISO;
  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    user: { id: PARENT_USER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

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
  // D-42 / §7.2: one date field, pre-filled with today. No mode chips —
  // "today" costs no tap, and a backdate or a scheduled raise costs one
  // typed date rather than a tap AND a date.
  it('pre-fills the single date field with today and submits it untouched', () => {
    const { getByTestId, onSubmit } = renderSheet();

    expect(getByTestId('pay-change-date-input').props.value).toBe(TODAY_ISO);
    fireEvent.press(getByTestId('pay-change-submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ valid_from: TODAY_ISO, rate_minor: 1850 })
    );
  });

  // GOLDEN #40: the caller's failed write is stated INSIDE the sheet — a
  // toast (or an inline error behind it) is invisible under the open sheet.
  it('renders the caller-supplied submitError inline above the submit button', () => {
    const { getByTestId } = renderSheet({ submitError: "That didn't send." });

    expect(getByTestId('pay-change-submit-error').props.children).toBe(
      "That didn't send."
    );
  });

  it('renders no error row when there is no submitError', () => {
    const { queryByTestId } = renderSheet();

    expect(queryByTestId('pay-change-submit-error')).toBeNull();
  });

  // D-16 reverses the old rule this test used to encode ("never submits a
  // future date — there is no way to select one"). A scheduled raise is the
  // normal case now; only the 12-month horizon bounds it.
  it('submits a SCHEDULED future date (D-16)', () => {
    const { getByTestId, queryByTestId, onSubmit } = renderSheet();

    fireEvent.changeText(getByTestId('pay-change-date-input'), '2026-09-01');

    expect(queryByTestId('pay-change-date-error')).toBeNull();
    expect(queryByTestId('pay-change-date-horizon-error')).toBeNull();

    fireEvent.press(getByTestId('pay-change-submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ valid_from: '2026-09-01' })
    );
  });

  it('refuses a date beyond the 12-month horizon, with its own inline error', () => {
    const { getByTestId, queryByTestId, onSubmit } = renderSheet();

    // TODAY_ISO is 2026-08-04, so the horizon is 2027-08-04.
    fireEvent.changeText(getByTestId('pay-change-date-input'), '2027-08-05');

    expect(getByTestId('pay-change-date-horizon-error')).toBeTruthy();
    expect(queryByTestId('pay-change-date-error')).toBeNull();

    fireEvent.press(getByTestId('pay-change-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a date that is not a real calendar date', () => {
    const { getByTestId, onSubmit } = renderSheet();

    fireEvent.changeText(getByTestId('pay-change-date-input'), '2026-02-30');

    expect(getByTestId('pay-change-date-error')).toBeTruthy();
    fireEvent.press(getByTestId('pay-change-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a past date and shows the backdating hint', () => {
    const { getByTestId, onSubmit } = renderSheet();

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

  // T11 / §7.3: a sentence per CHANGED TERM, not just the rate, on a
  // tone="attention" card — never a toast (GOLDEN #40).
  it('the consequence card appears for a mid-week effective date, one sentence per changed term', () => {
    const { getByTestId } = renderSheet();

    // Today (2026-08-04) is already a Tuesday, so the default date alone
    // triggers it once a new rate is typed.
    fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');

    expect(getByTestId('pay-change-consequence-card')).toBeTruthy();
    // The rate sentence, plus §7.3's always-last "check the week" line.
    expect(getByTestId('pay-change-consequence-0')).toBeTruthy();
    expect(getByTestId('pay-change-consequence-1')).toBeTruthy();
  });

  it('a changed GUARANTEE gets its own consequence sentence, not only the rate', () => {
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('pay-change-group-guaranteed-hours'));
    fireEvent.changeText(
      getByTestId('pay-change-guaranteed-hours-input'),
      '50'
    );

    expect(getByTestId('pay-change-consequence-card')).toBeTruthy();
    expect(getByTestId('pay-change-consequence-0')).toBeTruthy();
  });

  it('no consequence card mid-week when nothing has changed from the pre-fill', () => {
    const { queryByTestId } = renderSheet();

    // Default today (Tuesday) + every field pre-filled from the current
    // arrangement — nothing changed, so there is nothing to warn about.
    expect(queryByTestId('pay-change-consequence-card')).toBeNull();
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
    expect(mondayStart.queryByTestId('pay-change-consequence-card')).toBeNull();

    const sundayStart = renderSheet({
      todayISO: '2026-08-03',
      householdWeekStartsOn: 0,
    });
    fireEvent.changeText(
      sundayStart.getByTestId('pay-change-rate-input'),
      '19.50'
    );
    expect(sundayStart.getByTestId('pay-change-consequence-card')).toBeTruthy();
  });

  it('a mid-week CURRENCY change warns even when the rate is untouched', () => {
    // The rate diff row is `formatMoney(rate, currency)` on both sides, so a
    // currency flip alone is a changed term. A flip splits the week and the
    // API answers such a week with the `currency_change` earnings arm rather
    // than a total (earningsService.ts) — this card is the only warning
    // before that happens.
    const { getByTestId } = renderSheet();

    fireEvent.press(getByTestId('pay-change-currency-trigger'));
    fireEvent.press(getByTestId('pay-change-currency-EUR'));

    expect(getByTestId('pay-change-consequence-card')).toBeTruthy();
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

  it('no consequence card when the effective date IS a Monday', () => {
    const mondayArrangement = { ...currentArrangement };
    const { getByTestId, queryByTestId } = renderSheet({
      currentArrangement: mondayArrangement,
      todayISO: '2026-08-03', // a Monday
    });

    fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');

    expect(queryByTestId('pay-change-consequence-card')).toBeNull();
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

    // §4.2: a group opens by default when it has a value. A seeded
    // arrangement therefore reads top-to-bottom as a document, and a blank
    // one reads as a short required form — one rule, both behaviours.
    it('opens the groups that have a seeded value and leaves the empty ones closed', () => {
      const { getByTestId, queryByTestId } = renderSheet({
        currentArrangement: tieredArrangement,
      });

      expect(getByTestId('pay-change-group-overtime-content')).toBeTruthy();
      expect(queryByTestId('pay-change-group-mileage-content')).toBeNull();
      expect(
        queryByTestId('pay-change-group-guaranteed-hours-content')
      ).toBeNull();
    });

    it('leaves every group closed when the arrangement seeds nothing', () => {
      const { queryByTestId } = renderSheet();

      for (const group of [
        'overtime',
        'guaranteed-hours',
        'pto',
        'holidays',
        'mileage',
        'outside-wages',
        'in-writing',
      ]) {
        expect(queryByTestId(`pay-change-group-${group}-content`)).toBeNull();
      }
    });

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

      fireEvent.press(getByTestId('pay-change-group-overtime'));
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

      fireEvent.press(getByTestId('pay-change-group-overtime'));
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

  // 3-E5 / `holiday_hours_minutes` (095, §5 D-53). Same T17 hazard, and the
  // one that bites hardest: an unseeded credit means a parent who edits only
  // the rate silently cancels the family's paid holidays.
  describe('the unworked-holiday credit', () => {
    it('seeds from the current arrangement, in hours', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          holiday_hours_minutes: 480,
        },
      });

      expect(getByTestId('pay-change-holiday-hours-input').props.value).toBe(
        '8'
      );
    });

    it('a null column seeds an empty field, never a fabricated 8', () => {
      const { getByTestId } = renderSheet();

      fireEvent.press(getByTestId('pay-change-group-holidays'));
      expect(getByTestId('pay-change-holiday-hours-input').props.value).toBe(
        ''
      );
    });

    it('a rate-only change re-sends the seeded credit unchanged', () => {
      const { getByTestId, onSubmit } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          holiday_hours_minutes: 450,
        },
      });

      fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ holiday_hours_minutes: 450 })
      );
    });

    it('sends null when the field is left blank', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ holiday_hours_minutes: null })
      );
    });

    it('refuses to submit a typed zero rather than reading it as "no credit"', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.press(getByTestId('pay-change-group-holidays'));
      fireEvent.changeText(getByTestId('pay-change-holiday-hours-input'), '0');
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('opens the holidays group when only the credit is set', () => {
      // §4.2: "a group opens when it has a value". The group carries two
      // terms now, so either one must open it.
      const { getByTestId } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          holiday_hours_minutes: 480,
        },
      });
      expect(getByTestId('pay-change-holiday-hours-input').props.value).toBe(
        '8'
      );
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

      fireEvent.press(getByTestId('pay-change-group-holidays'));
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

      fireEvent.press(getByTestId('pay-change-group-holidays'));
      fireEvent.changeText(
        getByTestId('pay-change-worked-holiday-multiplier-input'),
        '0.5'
      );
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  // §5.2 / D-7. The preset offers itself from INSIDE the group it would fill,
  // never from a template picker above the form, and the confirm sheet is the
  // liability moment: disclaimer, review date, first-person checkbox, and a
  // RECORDED confirmation in `terms.preset`.
  describe('the common-defaults preset (§5.2, D-7)', () => {
    function openPresetSheet() {
      const utils = renderSheet();
      fireEvent.press(utils.getByTestId('pay-change-group-overtime'));
      fireEvent.press(utils.getByTestId('pay-change-preset-button'));
      return utils;
    }

    it('gates "Use these defaults" behind the first-person checkbox', () => {
      const { getByTestId } = openPresetSheet();

      expect(getByTestId('pay-preset-confirm').props.disabled).toBe(true);
      fireEvent.press(getByTestId('pay-preset-checkbox'));
      expect(getByTestId('pay-preset-confirm').props.disabled).toBe(false);
    });

    it('fills every overtime field from the preset values', () => {
      const { getByTestId } = openPresetSheet();

      fireEvent.press(getByTestId('pay-preset-checkbox'));
      fireEvent.press(getByTestId('pay-preset-confirm'));

      expect(
        getByTestId('pay-change-overtime-threshold-input').props.value
      ).toBe('40');
      expect(
        getByTestId('pay-change-overtime-multiplier-input').props.value
      ).toBe('1.5');
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

    it('shows the "check each one" line under the filled fields, and none before', () => {
      const { getByTestId, queryByTestId } = openPresetSheet();

      expect(queryByTestId('pay-change-preset-applied-note')).toBeNull();
      fireEvent.press(getByTestId('pay-preset-checkbox'));
      fireEvent.press(getByTestId('pay-preset-confirm'));
      expect(getByTestId('pay-change-preset-applied-note')).toBeTruthy();
    });

    it('records the confirmation in terms.preset — id, version and who took it on', () => {
      const { getByTestId, onSubmit } = openPresetSheet();

      fireEvent.press(getByTestId('pay-preset-checkbox'));
      fireEvent.press(getByTestId('pay-preset-confirm'));
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          overtime_threshold_minutes: 2400,
          doubletime_daily_threshold_minutes: 720,
          terms: expect.objectContaining({
            preset: expect.objectContaining({
              id: 'common-defaults',
              version: 1,
              confirmed_by: PARENT_USER_ID,
            }),
          }),
        })
      );
    });

    it('cancelling fills nothing', () => {
      const { getByTestId } = openPresetSheet();

      fireEvent.press(getByTestId('pay-preset-cancel'));

      // `BottomSheetBase` is a `Modal`, which keeps its host node in the tree
      // and flips `visible` — so the closed sheet is asserted on the prop, not
      // on the node's absence. The prop lives on the `-modal` node; the bare
      // testID is on the sheet card, the only node an iOS a11y tree exposes.
      expect(getByTestId('pay-preset-sheet-modal').props.visible).toBe(false);
      expect(
        getByTestId('pay-change-daily-overtime-threshold-input').props.value
      ).toBe('');
    });

    // D-52, owner verbatim: "We should never call out anything about
    // jurisdiction presets anywhere in the app… Just say most common values
    // are input." No user-visible string names a state or a review date — not
    // the button, not the sheet, not a hint, not an accessibility label.
    //
    // Asserted against the CATALOGUE, not the render: `react-i18next` is
    // key-echoing under bun:test (bun.setup.ts:593), so every `t()` call in a
    // rendered tree returns "preset.title" rather than the copy — a render
    // assertion here could never fail no matter what the English said. The
    // strings themselves are the only thing worth checking.
    it('names no state or jurisdiction in any preset string, in either language', () => {
      for (const catalogue of [enPay, esPay]) {
        for (const value of Object.values(catalogue.preset)) {
          expect(value).not.toMatch(
            /California|Wage Order|\bCA\b|jurisdicci|jurisdiction|reviewed|revisado/i
          );
        }
      }
    });

    // D-52 removed the review metadata, so the sheet has no review line and
    // no staleness warning to render. The disclaimer and the D-7 checkbox are
    // what carries the liability posture now, and both must say so: the
    // values are the most common ones, and following local law is the
    // family's own job.
    it('renders the preset sheet from those strings, with no review line', () => {
      const { getByTestId, queryByTestId } = openPresetSheet();

      expect(getByTestId('pay-preset-sheet')).toBeTruthy();
      expect(getByTestId('pay-preset-disclaimer')).toBeTruthy();
      expect(queryByTestId('pay-preset-reviewed')).toBeNull();
    });

    it('puts local-law compliance on the family, in the disclaimer AND the checkbox', () => {
      for (const catalogue of [enPay, esPay]) {
        // Not legal advice, and the values are "the most common" ones.
        expect(catalogue.preset.disclaimer).toMatch(
          /not legal advice|no asesoramiento legal/i
        );
        expect(catalogue.preset.disclaimer).toMatch(
          /most common values|valores más comunes/i
        );
        // The onus, said out loud on both surfaces.
        expect(catalogue.preset.disclaimer).toMatch(/law|ley/i);
        expect(catalogue.preset.checkbox).toMatch(/laws|leyes/i);
      }
    });
  });

  // D-13 / §4.3. Amounts are minor units like every other amount in this app,
  // and these never enter the week's gross.
  describe('outside wages (D-13)', () => {
    function openOutsideWages() {
      const utils = renderSheet();
      fireEvent.press(utils.getByTestId('pay-change-group-outside-wages'));
      return utils;
    }

    it('starts with no rows at all — an empty group is not a nag', () => {
      const { queryByTestId } = openOutsideWages();
      expect(queryByTestId('pay-change-stipend-label-0')).toBeNull();
    });

    it('adds a row, takes a label, an amount and a cadence, and submits it as terms.recurring', () => {
      const { getByTestId, onSubmit } = openOutsideWages();

      fireEvent.press(getByTestId('pay-change-stipend-add'));
      fireEvent.changeText(
        getByTestId('pay-change-stipend-label-0'),
        'Health stipend'
      );
      fireEvent.changeText(getByTestId('pay-change-stipend-amount-0'), '200');
      fireEvent.press(getByTestId('pay-change-stipend-cadence-0-monthly'));
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.objectContaining({
            recurring: [
              {
                label: 'Health stipend',
                amount_minor: 20000,
                cadence: 'monthly',
              },
            ],
          }),
        })
      );
    });

    it('removes the right row when a middle one is dropped', () => {
      const { getByTestId, onSubmit } = openOutsideWages();

      fireEvent.press(getByTestId('pay-change-stipend-add'));
      fireEvent.press(getByTestId('pay-change-stipend-add'));
      fireEvent.changeText(getByTestId('pay-change-stipend-label-0'), 'First');
      fireEvent.changeText(getByTestId('pay-change-stipend-amount-0'), '10');
      fireEvent.changeText(getByTestId('pay-change-stipend-label-1'), 'Second');
      fireEvent.changeText(getByTestId('pay-change-stipend-amount-1'), '20');

      fireEvent.press(getByTestId('pay-change-stipend-remove-0'));

      expect(getByTestId('pay-change-stipend-label-0').props.value).toBe(
        'Second'
      );
      fireEvent.press(getByTestId('pay-change-submit'));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.objectContaining({
            recurring: [
              { label: 'Second', amount_minor: 2000, cadence: 'weekly' },
            ],
          }),
        })
      );
    });

    it('refuses a row with an amount but no label rather than saving a nameless payment', () => {
      const { getByTestId, onSubmit } = openOutsideWages();

      fireEvent.press(getByTestId('pay-change-stipend-add'));
      fireEvent.changeText(getByTestId('pay-change-stipend-amount-0'), '200');
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('seeds the rows from the arrangement and opens the group', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          terms: {
            recurring: [
              {
                label: 'Holiday bonus',
                amount_minor: 50000,
                cadence: 'annual',
              },
            ],
          },
        },
      });

      expect(
        getByTestId('pay-change-group-outside-wages-content')
      ).toBeTruthy();
      expect(getByTestId('pay-change-stipend-label-0').props.value).toBe(
        'Holiday bonus'
      );
      expect(getByTestId('pay-change-stipend-amount-0').props.value).toBe(
        '500.00'
      );
    });
  });

  // T9 / §4.3. Documentary terms — they feed no pricing and get no
  // consequence sentence, but a change that never re-sends them drops them.
  describe('in writing (T9)', () => {
    it('submits the notice period in DAYS even though the field asks for weeks', () => {
      const { getByTestId, onSubmit } = renderSheet();

      fireEvent.press(getByTestId('pay-change-group-in-writing'));
      fireEvent.changeText(getByTestId('pay-change-notice-period-input'), '4');
      fireEvent.changeText(getByTestId('pay-change-probation-input'), '90');
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.objectContaining({
            notice_period_days: 28,
            probation_days: 90,
          }),
        })
      );
    });

    it('seeds from the stored bag and re-sends it on a rate-only change', () => {
      const { getByTestId, onSubmit } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          terms: { notice_period_days: 28, duties: 'School pickup' },
        },
      });

      expect(getByTestId('pay-change-group-in-writing-content')).toBeTruthy();
      expect(getByTestId('pay-change-notice-period-input').props.value).toBe(
        '4'
      );

      fireEvent.changeText(getByTestId('pay-change-rate-input'), '19.50');
      fireEvent.press(getByTestId('pay-change-submit'));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.objectContaining({
            notice_period_days: 28,
            duties: 'School pickup',
          }),
        })
      );
    });
  });

  // D-6 / §10. The figure is server-computed; a client-side `rate × hours` is
  // forbidden and is wrong the moment overtime exists.
  describe('the weekly equivalent (D-6)', () => {
    it('renders the STORED figure under guaranteed hours', () => {
      const { getByTestId } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          guaranteed_minutes_per_week: 3000,
          weekly_equivalent_minor: 154000,
        },
      });

      expect(getByTestId('pay-change-weekly-equivalent')).toBeTruthy();
    });

    it('renders nothing when the server sent no figure — never a fabricated one', () => {
      const { getByTestId, queryByTestId } = renderSheet({
        currentArrangement: {
          ...currentArrangement,
          guaranteed_minutes_per_week: 3000,
          weekly_equivalent_minor: null,
        },
      });

      expect(
        getByTestId('pay-change-group-guaranteed-hours-content')
      ).toBeTruthy();
      expect(queryByTestId('pay-change-weekly-equivalent')).toBeNull();
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

// P8 (mobile half) — the invite offer card opens THIS sheet in a third mode:
// the first statement of terms for a person who has not been hired yet, so
// there is no counterparty name, no "suggest a change" framing, and (since
// there is no currentArrangement to diff against) no §7.3 consequence card.
describe('PayChangeSheet mode="offer"', () => {
  it('titles itself from the household offer copy, with no counterparty subtitle', () => {
    // The test i18n setup echoes t() keys rather than resolving locale
    // strings (see other test files' notes on this) — assert the KEY, not
    // the English string, and confirm it's the household-namespace key
    // (not pay.json's `changeSheet.title`/`proposeSheet.title`).
    const { getByText, queryByTestId } = renderSheet({
      mode: 'offer',
      currentArrangement: undefined,
      defaultCurrency: 'USD',
    });

    expect(getByText('invite.offer.sheetTitle')).toBeTruthy();
    expect(enHousehold.invite.offer.sheetTitle).toBeTruthy();
    expect(queryByTestId('pay-offer-subtitle')).toBeNull();
    expect(queryByTestId('pay-propose-subtitle')).toBeNull();
  });

  it('never renders the change-sheet consequence card, even mid-week with a rate typed', () => {
    const { getByTestId, queryByTestId } = renderSheet({
      mode: 'offer',
      currentArrangement: undefined,
      defaultCurrency: 'USD',
    });

    fireEvent.changeText(getByTestId('pay-offer-rate-input'), '19.50');
    expect(queryByTestId('pay-offer-consequence-card')).toBeNull();
  });

  it('with no prior offer, seeds a BLANK form from the given default currency and today', () => {
    const { getByTestId } = renderSheet({
      mode: 'offer',
      currentArrangement: undefined,
      defaultCurrency: 'EUR',
    });

    expect(getByTestId('pay-offer-date-input').props.value).toBe(TODAY_ISO);
    expect(getByTestId('pay-offer-currency-prefix').props.children).toBe('€');
    expect(getByTestId('pay-offer-rate-input').props.value).toBe('');
  });

  it('submits a valid offer request', () => {
    const { getByTestId, onSubmit } = renderSheet({
      mode: 'offer',
      currentArrangement: undefined,
      defaultCurrency: 'USD',
    });

    fireEvent.changeText(getByTestId('pay-offer-rate-input'), '20.00');
    fireEvent.press(getByTestId('pay-offer-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-offer-submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ rate_minor: 2000, valid_from: TODAY_ISO })
    );
  });

  // Editing an already-drafted offer (ManageInviteScreen) round-trips through
  // `offerRequestToArrangementStub` — the same "no real arrangement yet, need
  // something to seed a form from" trick `proposalTermsToArrangement` uses
  // for a nanny's own draft, independently copied since an invite offer has
  // no carer/proposal id to hand it.
  /**
   * P1/1.6. A BLANK form is exactly the shape `ClockInBlockedCard` renders:
   * the nanny proposing her own terms has no arrangement to seed from —
   * that absence IS the block — so the sheet takes the blank branch, and the
   * blank branch used to hardcode today. Losing Monday and Tuesday hurts
   * most in precisely this flow, and the fix has to be VISIBLE (it changes
   * what the family owes for days already worked), which a pre-filled past
   * date plus the existing backdating hint is.
   */
  it('a BLANK form honours initialEffectiveDateISO — her first day, not today', () => {
    const { getByTestId } = renderSheet({
      mode: 'propose',
      currentArrangement: undefined,
      defaultCurrency: 'USD',
      initialEffectiveDateISO: '2026-07-28',
    });

    expect(getByTestId('pay-propose-date-input').props.value).toBe(
      '2026-07-28'
    );
    expect(getByTestId('pay-propose-backdating-hint')).toBeTruthy();
  });

  it('a blank form with no initialEffectiveDateISO still opens on today', () => {
    const { getByTestId } = renderSheet({
      mode: 'propose',
      currentArrangement: undefined,
      defaultCurrency: 'USD',
    });

    expect(getByTestId('pay-propose-date-input').props.value).toBe(TODAY_ISO);
  });

  it('the seeded past date is what gets submitted, not silently reset to today', () => {
    const { getByTestId, onSubmit } = renderSheet({
      mode: 'propose',
      currentArrangement: undefined,
      defaultCurrency: 'USD',
      initialEffectiveDateISO: '2026-07-28',
    });

    fireEvent.changeText(getByTestId('pay-propose-rate-input'), '25.00');
    fireEvent.press(getByTestId('pay-propose-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-propose-submit'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ valid_from: '2026-07-28', rate_minor: 2500 })
    );
  });

  /**
   * P1/1.2. "Set new terms" described a save that no longer happens — the
   * terms go to the other side, who has to agree. The button names the
   * recipient, and the receipt (not a dialog) carries the consequence.
   */
  it('the change-mode submit button names the recipient', () => {
    const { getByTestId } = renderSheet({ counterpartyName: 'Andrea' });

    expect(getByTestId('pay-change-submit-label')).toBeTruthy();
    // `t()` echoes the KEY under test i18n, so the catalogue is where the
    // placeholder can actually be pinned — plus a source check that the
    // component feeds it. Neither half alone would catch a dropped name.
    expect(enPay.changeSheet.submitButton).toBe('Send to {{name}}');
    expect(esPay.changeSheet.submitButton).toBe('Enviar a {{name}}');
    const source = readFileSync(
      join(__dirname, '../PayChangeSheet.tsx'),
      'utf8'
    );
    expect(source).toContain(
      "t('changeSheet.submitButton', { name: counterpartyName ?? '' })"
    );
  });

  it('the toast the receipt replaced is gone from the catalogue, in both locales', () => {
    expect('savedToast' in enPay.changeSheet).toBe(false);
    expect('savedToast' in esPay.changeSheet).toBe(false);
    expect('savedToast' in enPay.setup).toBe(false);
    expect('savedToast' in esPay.setup).toBe(false);
  });

  it('editing an existing offer round-trips: seeds the form from the prior request', () => {
    const priorOffer: CreatePayArrangementRequest = {
      rate_minor: 1800,
      currency: 'GBP',
      overtime_multiplier: 1.5,
      valid_from: '2026-08-10',
    };
    const { getByTestId } = renderSheet({
      mode: 'offer',
      currentArrangement: offerRequestToArrangementStub(priorOffer, 'GBP'),
      defaultCurrency: 'GBP',
      // `seedPayTermsFormState` seeds the DATE from `initialEffectiveDateISO`
      // (a "change" proposes a NEW date, never redisplays the old one) — the
      // caller re-opening a prior offer for editing supplies its `valid_from`
      // explicitly, same as `ProposalReviewScreen` pre-filling a countered date.
      initialEffectiveDateISO: priorOffer.valid_from,
    });

    expect(getByTestId('pay-offer-rate-input').props.value).toBe('18.00');
    expect(getByTestId('pay-offer-date-input').props.value).toBe('2026-08-10');
  });
});
