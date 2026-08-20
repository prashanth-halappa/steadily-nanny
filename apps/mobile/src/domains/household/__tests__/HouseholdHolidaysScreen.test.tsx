/**
 * @module domains/household/__tests__/HouseholdHolidaysScreen.test
 *
 * Pattern B — render the real holidays settings screen. The four cases
 * that a wrong implementation gets backwards: catalog order + this year's
 * dates, ABSENT-means-not-observed, one Save of all 11, nanny read-only.
 * Plus country pack, null-dated rows, custom days, and a single Save that
 * issues both PUTs.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import {
  HOLIDAY_COUNTRIES,
  holidayDatesInYear,
} from '@steadily-nanny/shared-types/holidayPacks';
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

interface CustomHolidayRow {
  id: string;
  household_id: string;
  name: string;
  dates: string[];
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

function customRow(name: string, dates: string[]): CustomHolidayRow {
  return {
    id: `custom-${name}`,
    household_id: HOUSEHOLD_ID,
    name,
    dates,
    created_at: NOW,
    updated_at: NOW,
  };
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
let customHolidayRows: CustomHolidayRow[] = [];
let householdCountry: string = HOLIDAY_COUNTRIES.US;
let onboardingRole: 'parent' | 'nanny' | 'helper' = 'parent';
let isPastMember = false;
const mutateMock = mock((_input: Record<string, unknown>) =>
  Promise.resolve([])
);
const customMutateMock = mock((_input: Record<string, unknown>) =>
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

  mock.module('@/src/hooks/queries/useHouseholdById', () => ({
    useHouseholdById: () => ({
      household: { id: HOUSEHOLD_ID, country: householdCountry },
      isLoading: false,
      isError: false,
      notMember: false,
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

  mock.module('@/src/hooks/queries/useHouseholdCustomHolidays', () => ({
    useHouseholdCustomHolidays: () => ({
      data: customHolidayRows,
      isLoading: false,
      isError: false,
      refetch: mock(() => Promise.resolve()),
    }),
  }));

  mock.module('@/src/hooks/mutations/useSetHouseholdCustomHolidays', () => ({
    useSetHouseholdCustomHolidays: () => ({
      mutate: customMutateMock,
      mutateAsync: customMutateMock,
      isPending: false,
    }),
  }));

  mock.module(
    '@/src/domains/household/components/CustomHolidayEditSheet',
    () => {
      const React = require('react');
      return {
        CustomHolidayEditSheet: ({
          visible,
          testID,
        }: {
          visible: boolean;
          testID?: string;
        }) =>
          visible
            ? React.createElement('View', {
                testID: testID ?? 'custom-holiday-edit-sheet',
              })
            : null,
      };
    }
  );

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
  householdCountry = HOLIDAY_COUNTRIES.US;
  holidayRows = allObserved(true);
  customHolidayRows = [];
  mutateMock.mockClear();
  customMutateMock.mockClear();
});

afterEach(() => {
  setSystemTime();
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

  it('a CA household renders the Canadian catalog, not the US federal set', async () => {
    householdCountry = HOLIDAY_COUNTRIES.CA;
    const caCatalog = holidayDatesInYear(HOLIDAY_COUNTRIES.CA, YEAR);
    holidayRows = caCatalog
      .filter(entry => entry.date !== null)
      .map(entry => holidayRow(entry.key, true));

    const { getByTestId, queryByTestId, toJSON } = renderWithProviders(
      <HouseholdHolidaysScreen />
    );

    await waitFor(() => {
      expect(getByTestId(`holiday-toggle-${caCatalog[0]?.key}`)).toBeTruthy();
    });

    const toggleIds = collectTestIds(toJSON()).filter(id =>
      id.startsWith('holiday-toggle-')
    );
    expect(toggleIds).toEqual(
      caCatalog.map(entry => `holiday-toggle-${entry.key}`)
    );
    expect(queryByTestId('holiday-toggle-independence_day')).toBeNull();
    expect(queryByTestId('holiday-toggle-juneteenth')).toBeNull();
    expect(getByTestId('holiday-toggle-canada_day')).toBeTruthy();
    expect(getByTestId('holiday-toggle-boxing_day')).toBeTruthy();
  });

  it('an entry whose date is null still renders its toggle with no date line', async () => {
    householdCountry = HOLIDAY_COUNTRIES.CA;
    holidayRows = [];
    setSystemTime(new Date('2028-06-15T12:00:00.000Z'));
    const ca2028 = holidayDatesInYear(HOLIDAY_COUNTRIES.CA, 2028);
    const undated = ca2028.filter(entry => entry.date === null);
    expect(undated.length).toBeGreaterThan(0);

    const { getByTestId } = renderWithProviders(<HouseholdHolidaysScreen />);

    await waitFor(() => {
      expect(getByTestId(`holiday-toggle-${undated[0]?.key}`)).toBeTruthy();
    });

    for (const entry of undated) {
      expect(getByTestId(`holiday-toggle-${entry.key}`)).toBeTruthy();
    }
  });

  it('custom rows render the stored name (not through t()) and joined dates', async () => {
    customHolidayRows = [customRow('Diwali', ['2026-11-08', '2026-11-09'])];

    const { getByTestId, getByText, queryByText } = renderWithProviders(
      <HouseholdHolidaysScreen />
    );

    await waitFor(() => {
      expect(getByTestId('custom-holiday-row-0')).toBeTruthy();
    });

    expect(getByText('Diwali')).toBeTruthy();
    expect(queryByText('holidays.names.Diwali')).toBeNull();
    expect(
      getByText(
        `${formatDisplayDateWithYear('2026-11-08')} · ${formatDisplayDateWithYear('2026-11-09')}`
      )
    ).toBeTruthy();
    expect(getByTestId('custom-holiday-edit-0')).toBeTruthy();
    expect(getByTestId('custom-holiday-delete-0')).toBeTruthy();
    expect(getByTestId('custom-holiday-add')).toBeTruthy();
  });

  it('Save issues both the toggle PUT and the custom-days PUT', async () => {
    customHolidayRows = [customRow('Diwali', ['2026-11-08'])];
    const { getByTestId } = renderWithProviders(<HouseholdHolidaysScreen />);

    await waitFor(() => {
      expect(getByTestId('custom-holiday-row-0')).toBeTruthy();
    });

    fireEvent.press(getByTestId('household-holidays-screen-cta'));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
      expect(customMutateMock).toHaveBeenCalledTimes(1);
    });

    const customPayload = customMutateMock.mock.calls[0]?.[0] as {
      custom_holidays: Array<{ name: string; dates: string[] }>;
    };
    expect(customPayload.custom_holidays).toEqual([
      { name: 'Diwali', dates: ['2026-11-08'] },
    ]);
  });

  it('deleting the last custom day and Save PUTs an empty custom set', async () => {
    customHolidayRows = [customRow('Diwali', ['2026-11-08'])];
    const { getByTestId, queryByTestId } = renderWithProviders(
      <HouseholdHolidaysScreen />
    );

    await waitFor(() => {
      expect(getByTestId('custom-holiday-delete-0')).toBeTruthy();
    });

    fireEvent.press(getByTestId('custom-holiday-delete-0'));
    expect(queryByTestId('custom-holiday-row-0')).toBeNull();

    fireEvent.press(getByTestId('household-holidays-screen-cta'));

    await waitFor(() => {
      expect(customMutateMock).toHaveBeenCalledTimes(1);
    });

    expect(customMutateMock.mock.calls[0]?.[0]).toEqual({
      custom_holidays: [],
    });
  });

  it('a nanny sees custom rows read-only — no add, edit, or delete', async () => {
    onboardingRole = 'nanny';
    customHolidayRows = [customRow('Diwali', ['2026-11-08'])];

    const { getByTestId, getByText, queryByTestId } = renderWithProviders(
      <HouseholdHolidaysScreen />
    );

    await waitFor(() => {
      expect(getByText('Diwali')).toBeTruthy();
    });

    expect(getByTestId('custom-holiday-row-0')).toBeTruthy();
    expect(queryByTestId('custom-holiday-add')).toBeNull();
    expect(queryByTestId('custom-holiday-edit-0')).toBeNull();
    expect(queryByTestId('custom-holiday-delete-0')).toBeNull();
  });
});

describe('HouseholdHolidaysScreen — section header typography (01-LAWS Rule A)', () => {
  it('labels the custom-holiday section with DayGroup, not Body weight=medium', async () => {
    const source = await Bun.file(
      new URL('../components/HouseholdHolidaysScreen.tsx', import.meta.url)
        .pathname
    ).text();

    const sectionIdx = source.indexOf('testID="custom-holiday-section"');
    expect(sectionIdx).toBeGreaterThan(-1);
    const window = source.slice(sectionIdx, sectionIdx + 280);
    expect(window).toContain(
      "<DayGroup>{t('holidays.custom.sectionTitle')}</DayGroup>"
    );
    expect(window).not.toContain(
      '<Body weight="medium">{t(\'holidays.custom.sectionTitle\')}</Body>'
    );
  });
});
