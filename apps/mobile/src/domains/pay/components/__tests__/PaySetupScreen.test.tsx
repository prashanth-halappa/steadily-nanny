/**
 * @module domains/pay/components/__tests__/PaySetupScreen
 *
 * D15 wiring test: renders the REAL `PaySetupScreen`. Covers the two
 * differences from `PayChangeSheet` that make this its own screen: the
 * effective-date default (day she joined, when in the past) and the
 * required — never pre-selected — cancellation choice.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

let PaySetupScreen: typeof import('../PaySetupScreen').PaySetupScreen;

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});
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

const PARENT_USER_ID = 'parent-user-1';
const NANNY_ID = 'nanny-a';
const HOUSEHOLD_ID = 'household-1';
const now = '2026-08-01T00:00:00.000Z';

const baseHousehold = {
  id: HOUSEHOLD_ID,
  name: 'The Smiths',
  timezone: 'UTC',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  approval_timeout_minutes: 60,
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: PARENT_USER_ID,
  created_at: now,
  updated_at: now,
};

const parentMembership = {
  id: 'member-1',
  household_id: HOUSEHOLD_ID,
  user_id: PARENT_USER_ID,
  role: 'owner',
  can_edit: true,
  status: 'active',
  display_name_override: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
};

function nannyMember(joinedAt: string) {
  return {
    id: 'member-nanny',
    household_id: HOUSEHOLD_ID,
    user_id: NANNY_ID,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: 'Priya',
    colour: null,
    joined_at: joinedAt,
    created_at: now,
    updated_at: now,
  };
}

const listMock = mock(() => Promise.resolve([baseHousehold]));
const listMembersMock = mock(() =>
  Promise.resolve([nannyMember('2026-07-01T00:00:00.000Z')])
);
const membershipsListMock = mock(() => Promise.resolve([parentMembership]));
const payCreateMock = mock((_h: string, carerId: string, input: unknown) =>
  Promise.resolve({ id: 'arr-1', carer_id: carerId, ...(input as object) })
);
const routerBack = mock();
const routerReplace = mock();

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: routerReplace,
    back: routerBack,
    navigate: mock(),
  }),
  useLocalSearchParams: mock(() => ({ carerId: NANNY_ID })),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'StackScreen' },
  Tabs: { Screen: 'TabsScreen' },
}));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: listMock, listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
const payCurrentMock = mock<(...args: unknown[]) => Promise<unknown>>(() =>
  Promise.resolve(null)
);
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: payCurrentMock,
    getHistory: mock(() => Promise.resolve([])),
    create: payCreateMock,
  },
}));

beforeAll(async () => {
  PaySetupScreen = (await import('../PaySetupScreen')).PaySetupScreen;
});

beforeEach(() => {
  // Restore bun.setup.ts's en-GB default — one test below re-points this and
  // the override would otherwise leak into every test after it.
  (
    getLocales as unknown as { mockImplementation: (fn: () => unknown) => void }
  ).mockImplementation(() => [
    {
      languageCode: 'en',
      regionCode: 'GB',
      languageTag: 'en-GB',
      currencyCode: 'GBP',
    },
  ]);
  listMock.mockReset();
  listMembersMock.mockReset();
  membershipsListMock.mockReset();
  payCreateMock.mockReset();
  payCurrentMock.mockReset();
  routerBack.mockClear();
  routerReplace.mockClear();

  listMock.mockImplementation(() => Promise.resolve([baseHousehold]));
  listMembersMock.mockImplementation(() =>
    Promise.resolve([nannyMember('2026-07-01T00:00:00.000Z')])
  );
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([parentMembership])
  );
  payCurrentMock.mockImplementation(() => Promise.resolve(null));
  payCreateMock.mockImplementation(
    (_h: string, carerId: string, input: unknown) =>
      Promise.resolve({ id: 'arr-1', carer_id: carerId, ...(input as object) })
  );

  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    user: { id: PARENT_USER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('PaySetupScreen', () => {
  it('renders the real form with the setup-specific title/subtitle and every field', async () => {
    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    expect(getByTestId('pay-setup-chip-today')).toBeTruthy();
    expect(getByTestId('pay-setup-chip-earlier')).toBeTruthy();
    expect(getByTestId('pay-setup-overtime-threshold-input')).toBeTruthy();
    expect(getByTestId('pay-setup-guaranteed-hours-input')).toBeTruthy();
    expect(getByTestId('pay-setup-pto-hours-input')).toBeTruthy();
    expect(getByTestId('pay-setup-mileage-rate-input')).toBeTruthy();
    expect(getByTestId('pay-setup-cancellation-chip-window')).toBeTruthy();
    expect(getByTestId('pay-setup-cancellation-chip-none')).toBeTruthy();
  });

  it('defaults the effective date to the day she joined, since it is in the past', async () => {
    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-chip-earlier').props.variant).toBe(
        'default'
      )
    );
    expect(getByTestId('pay-setup-date-input').props.value).toBe('2026-07-01');
  });

  describe('review finding 9: the joined-date default only applies when there is genuinely no current arrangement yet', () => {
    it('when a current arrangement already exists for this carer, redirects to /settings/pay and does not render the form', async () => {
      payCurrentMock.mockImplementation(() =>
        Promise.resolve({
          id: 'arr-existing',
          household_id: HOUSEHOLD_ID,
          carer_id: NANNY_ID,
          rate_minor: 1500,
          bill_rate_minor: null,
          currency: 'GBP',
          overtime_threshold_minutes: null,
          overtime_multiplier: 1.5,
          guaranteed_minutes_per_week: null,
          pto_entitlement_minutes_per_year: null,
          mileage_rate_per_mile_minor: null,
          cancellation_paid_within_hours: null,
          valid_from: '2026-05-01',
          carer_display_name: 'Priya',
          note: null,
          created_by: PARENT_USER_ID,
          created_at: now,
        })
      );

      const { queryByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(routerReplace).toHaveBeenCalledWith('/settings/pay')
      );
      expect(queryByTestId('pay-setup-rate-input')).toBeNull();
    });

    it('with no current arrangement, still defaults to the joined date (unchanged behaviour)', async () => {
      payCurrentMock.mockImplementation(() => Promise.resolve(null));

      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-chip-earlier').props.variant).toBe(
          'default'
        )
      );
      expect(getByTestId('pay-setup-date-input').props.value).toBe(
        '2026-07-01'
      );
    });
  });

  it('the cancellation choice starts unselected — Save stays disabled until one is picked', async () => {
    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    expect(
      getByTestId('pay-setup-cancellation-chip-window').props.variant
    ).toBe('outline');
    expect(getByTestId('pay-setup-cancellation-chip-none').props.variant).toBe(
      'outline'
    );
    expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(true);

    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(true);

    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(false);
  });

  it('a REMOVED parent (past member) gets "not available", never the pay form', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([{ ...parentMembership, status: 'removed' }])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaySetupScreen />
    );

    await waitFor(() =>
      expect(getByTestId('pay-setup-not-available')).toBeTruthy()
    );
    expect(queryByTestId('pay-setup-rate-input')).toBeNull();
  });

  it('defaults the currency to the device Language & Region, not a hardcoded GBP', async () => {
    // The device value is a PREFILL, so it has to reach the submitted request
    // when untouched. `getLocales` is the global mock from `bun.setup.ts`;
    // only the per-render `useState(getDeviceCurrency())` reads it, so
    // re-pointing it before render is enough. (`CURRENCY_OPTIONS` in
    // `currencyOptions()` reads the device value too, but this asserts the
    // SELECTION, not the list ordering.)
    (
      getLocales as unknown as {
        mockImplementation: (fn: () => unknown) => void;
      }
    ).mockImplementation(() => [{ currencyCode: 'USD', languageTag: 'en-US' }]);

    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    expect(getByTestId('pay-setup-currency-prefix').props.children).toBe('$');

    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-setup-screen-cta'));

    await waitFor(() =>
      expect(payCreateMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_ID,
        expect.objectContaining({ currency: 'USD' })
      )
    );
  });

  it('lets the device default be overridden — currency belongs to the arrangement, not the phone', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaySetupScreen />
    );

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    fireEvent.press(getByTestId('pay-setup-currency-trigger'));
    fireEvent.press(getByTestId('pay-setup-currency-EUR'));
    // Picking closes the list, so the long form doesn't stay long.
    expect(queryByTestId('pay-setup-currency-list')).toBeNull();
    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-setup-screen-cta'));

    await waitFor(() =>
      expect(payCreateMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_ID,
        expect.objectContaining({ currency: 'EUR' })
      )
    );
  });

  it('saves through the real mutation and returns on success', async () => {
    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-setup-screen-cta'));

    await waitFor(() =>
      expect(payCreateMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_ID,
        expect.objectContaining({
          rate_minor: 1850,
          valid_from: '2026-07-01',
          cancellation_paid_within_hours: null,
        })
      )
    );
    await waitFor(() => expect(routerBack).toHaveBeenCalled());
  });
});
