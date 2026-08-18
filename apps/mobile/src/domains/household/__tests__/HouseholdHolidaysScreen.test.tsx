/**
 * @module domains/household/__tests__/HouseholdHolidaysScreen.test
 *
 * Pattern B — render the real holidays settings screen. The four cases
 * that a wrong implementation gets backwards: catalog order + this year's
 * dates, ABSENT-means-not-observed, one Save of all 11, nanny read-only.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { usFederalHolidayDates } from '@steadily-nanny/shared-types/usFederalHolidays';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { formatDisplayDateWithYear } from '@/src/domains/pay/utils/payArrangementForm';
import { renderWithProviders } from '@/src/test-utils';

const YEAR = new Date().getFullYear();
const CATALOG = usFederalHolidayDates(YEAR);
const HOUSEHOLD_ID = 'hh-1';
const NOW = '2026-08-01T00:00:00.000Z';

interface HolidayRow {
  id: string;
  household_id: string;
  holiday_key: string;
  observed: boolean;
  created_at: string;
  updated_at: string;
}

function holidayRow(key: string, observed: boolean): HolidayRow {
  return {
    id: `id-${key}`,
    household_id: HOUSEHOLD_ID,
    holiday_key: key,
    observed,
    created_at: NOW,
    updated_at: NOW,
  };
}

function allObserved(observed: boolean): HolidayRow[] {
  return CATALOG.map(entry => holidayRow(entry.key, observed));
}

function collectTestIds(node: unknown): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (typeof value !== 'object') return;
    const rec = value as {
      props?: { testID?: string; children?: unknown };
      children?: unknown;
    };
    if (typeof rec.props?.testID === 'string') {
      ids.push(rec.props.testID);
    }
    visit(rec.children);
    visit(rec.props?.children);
  };
  visit(node);
  return ids;
}

let holidayRows: HolidayRow[] = [];
let onboardingRole: 'parent' | 'nanny' | 'helper' = 'parent';
let isPastMember = false;
const mutateMock = mock((_input: Record<string, unknown>) =>
  Promise.resolve([])
);

let HouseholdHolidaysScreen: typeof import('../components/HouseholdHolidaysScreen').HouseholdHolidaysScreen;

beforeAll(async () => {
  mock.module('@/src/components/ui/switch', () => {
    const React = require('react');
    return {
      Switch: ({
        checked,
        onCheckedChange,
        testID,
      }: {
        checked?: boolean;
        onCheckedChange?: (value: boolean) => void;
        testID?: string;
      }) =>
        React.createElement('Pressable', {
          testID,
          accessibilityState: { checked: !!checked },
          onPress: () => onCheckedChange?.(!checked),
        }),
    };
  });

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      status: 'onboarded' as const,
      role: onboardingRole,
      householdId: HOUSEHOLD_ID,
      isPastMember,
    }),
  }));

  mock.module('@/src/hooks/queries/useHouseholdHolidays', () => ({
    useHouseholdHolidays: () => ({
      data: holidayRows,
      isLoading: false,
      isError: false,
      refetch: mock(() => Promise.resolve()),
    }),
  }));

  mock.module('@/src/hooks/mutations/useSetHouseholdHolidays', () => ({
    useSetHouseholdHolidays: () => ({
      mutate: mutateMock,
      mutateAsync: mutateMock,
      isPending: false,
    }),
  }));

  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(() => undefined),
    showErrorToast: mock(() => undefined),
  }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
  }));

  ({ HouseholdHolidaysScreen } = await import(
    '../components/HouseholdHolidaysScreen'
  ));
});

beforeEach(() => {
  onboardingRole = 'parent';
  isPastMember = false;
  holidayRows = allObserved(true);
  mutateMock.mockClear();
});

describe('HouseholdHolidaysScreen', () => {
  it("renders 11 rows in usFederalHolidayDates order, each showing this year's date", async () => {
    const { getByTestId, getByText, toJSON } = renderWithProviders(
      <HouseholdHolidaysScreen />
    );

    await waitFor(() => {
      expect(getByTestId(`holiday-toggle-${CATALOG[0]?.key}`)).toBeTruthy();
    });

    expect(CATALOG).toHaveLength(11);
    const toggleIds = collectTestIds(toJSON()).filter(id =>
      id.startsWith('holiday-toggle-')
    );
    expect(toggleIds).toEqual(
      CATALOG.map(entry => `holiday-toggle-${entry.key}`)
    );

    for (const entry of CATALOG) {
      expect(getByTestId(`holiday-toggle-${entry.key}`)).toBeTruthy();
      expect(getByText(formatDisplayDateWithYear(entry.date))).toBeTruthy();
    }
  });

  it('a holiday_key absent from the fetched rows renders OFF', async () => {
    const absentKey = 'columbus_day';
    holidayRows = CATALOG.filter(entry => entry.key !== absentKey).map(entry =>
      holidayRow(entry.key, true)
    );

    const { getByTestId } = renderWithProviders(<HouseholdHolidaysScreen />);

    await waitFor(() => {
      expect(
        getByTestId('holiday-toggle-independence_day').props.accessibilityState
          .checked
      ).toBe(true);
    });

    expect(
      getByTestId(`holiday-toggle-${absentKey}`).props.accessibilityState
        .checked
    ).toBe(false);
  });

  it('parent flips one switch and taps Save -> mutation is called once with all 11 entries and only that key changed', async () => {
    const flippedKey = 'christmas_day';
    const { getByTestId } = renderWithProviders(<HouseholdHolidaysScreen />);

    await waitFor(() => {
      expect(getByTestId(`holiday-toggle-${flippedKey}`)).toBeTruthy();
    });

    fireEvent.press(getByTestId(`holiday-toggle-${flippedKey}`));
    fireEvent.press(getByTestId('household-holidays-screen-cta'));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });

    const payload = mutateMock.mock.calls[0]?.[0] as {
      holidays: Array<{ holiday_key: string; observed: boolean }>;
    };
    expect(payload.holidays).toHaveLength(11);
    expect(payload.holidays.map(entry => entry.holiday_key)).toEqual(
      CATALOG.map(entry => entry.key)
    );
    for (const entry of payload.holidays) {
      expect(entry.observed).toBe(entry.holiday_key !== flippedKey);
    }
  });

  it('role nanny -> switches disabled and no Save control', async () => {
    onboardingRole = 'nanny';
    const { getByTestId, getByText, queryByText } = renderWithProviders(
      <HouseholdHolidaysScreen />
    );

    await waitFor(() => {
      expect(getByTestId('holiday-toggle-new_years_day')).toBeTruthy();
    });

    const before = getByTestId('holiday-toggle-new_years_day').props
      .accessibilityState.checked;
    fireEvent.press(getByTestId('holiday-toggle-new_years_day'));
    expect(
      getByTestId('holiday-toggle-new_years_day').props.accessibilityState
        .checked
    ).toBe(before);

    expect(getByTestId('household-holidays-screen-cta')).toBeTruthy();
    expect(getByText('done')).toBeTruthy();
    expect(queryByText('holidays.saveButton')).toBeNull();
    expect(getByText('holidays.readOnlyNote')).toBeTruthy();
  });
});
