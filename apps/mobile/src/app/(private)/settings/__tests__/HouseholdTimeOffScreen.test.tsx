/**
 * @module app/(private)/settings/__tests__/HouseholdTimeOffScreen.test
 *
 * D15 wiring test: renders the REAL `household-time-off` route — the
 * parent's "Mark N hours paid" entry point (TIER0-CX-SPEC.md §5.1) — with
 * only the API leaves mocked. Covers the paid-status pill and reachability
 * of the mark-paid sheet through a real row tap.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

let HouseholdTimeOffScreen: typeof import('../household-time-off').default;

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

const routerBack = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: mock(),
    back: routerBack,
    navigate: mock(),
  }),
  useLocalSearchParams: () => ({}),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'StackScreen' },
  Tabs: { Screen: 'TabsScreen' },
}));

const PARENT_ID = 'parent-1';
const NANNY_ID = 'nanny-1';
const HOUSEHOLD_ID = 'household-1';
const TIME_OFF_ID = 'timeoff-1';
const now = '2026-08-01T00:00:00.000Z';

const household = {
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
  created_by: PARENT_ID,
  created_at: now,
  updated_at: now,
};

const parentMembership = {
  id: 'member-parent',
  household_id: HOUSEHOLD_ID,
  user_id: PARENT_ID,
  role: 'owner',
  can_edit: true,
  status: 'active',
  display_name_override: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
};

const nannyMember = {
  id: 'member-nanny',
  household_id: HOUSEHOLD_ID,
  user_id: NANNY_ID,
  role: 'nanny',
  can_edit: false,
  status: 'active',
  display_name_override: 'Amara',
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
};

const timeOffRow = {
  id: TIME_OFF_ID,
  user_id: NANNY_ID,
  starts_at: '2026-08-24T00:00:00.000Z',
  ends_at: '2026-08-27T00:00:00.000Z',
  all_day: true,
  message: null,
  status: 'confirmed',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: now,
  updated_at: now,
};

const listMock = mock(() => Promise.resolve([household]));
const listMembersMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([parentMembership, nannyMember])
);
const membershipsListMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([parentMembership])
);
const listForHouseholdMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([timeOffRow])
);
const ptoBalanceMock = mock<() => Promise<unknown>>(() =>
  Promise.resolve({
    carer_id: NANNY_ID,
    household_id: HOUSEHOLD_ID,
    year: 2026,
    entitlement_minutes: 8400,
    accrued_minutes: 8400,
    used_minutes: 0,
    balance_minutes: 8400,
  })
);
const ptoLedgerMock = mock<() => Promise<unknown[]>>(() => Promise.resolve([]));
const markPaidMock = mock<() => Promise<unknown>>(() => Promise.resolve({}));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: listMock, listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
mock.module('@/src/api/endpoints/timeOff', () => ({
  timeOffApi: { listForHousehold: listForHouseholdMock },
}));
mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: {
    getBalance: ptoBalanceMock,
    getLedger: ptoLedgerMock,
    markPaid: markPaidMock,
  },
}));

beforeAll(async () => {
  HouseholdTimeOffScreen = (await import('../household-time-off')).default;
});

beforeEach(() => {
  listMock.mockReset();
  listMembersMock.mockReset();
  membershipsListMock.mockReset();
  listForHouseholdMock.mockReset();
  ptoBalanceMock.mockReset();
  ptoLedgerMock.mockReset();
  markPaidMock.mockReset();

  listMock.mockImplementation(() => Promise.resolve([household]));
  listMembersMock.mockImplementation(() =>
    Promise.resolve([parentMembership, nannyMember])
  );
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([parentMembership])
  );
  listForHouseholdMock.mockImplementation(() => Promise.resolve([timeOffRow]));
  ptoBalanceMock.mockImplementation(() =>
    Promise.resolve({
      carer_id: NANNY_ID,
      household_id: HOUSEHOLD_ID,
      year: 2026,
      entitlement_minutes: 8400,
      accrued_minutes: 8400,
      used_minutes: 0,
      balance_minutes: 8400,
    })
  );
  ptoLedgerMock.mockImplementation(() => Promise.resolve([]));
  markPaidMock.mockImplementation(() => Promise.resolve({}));

  useAuthStore.setState({
    session: { user: { id: PARENT_ID } } as unknown as never,
    user: { id: PARENT_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('household-time-off route (parent mark-paid entry point)', () => {
  it('renders a row with the real paid-status pill, never the raw status string', async () => {
    const { getByTestId, getByText, queryByText } = renderWithProviders(
      <HouseholdTimeOffScreen />
    );

    await waitFor(() =>
      expect(getByTestId(`household-time-off-${TIME_OFF_ID}`)).toBeTruthy()
    );
    expect(getByText('householdTimeOff.notMarkedPaid')).toBeTruthy();
    expect(queryByText('confirmed')).toBeNull();
  });

  it('tapping a row reaches the mark-paid sheet and submits through the real mutation', async () => {
    const { getByTestId } = renderWithProviders(<HouseholdTimeOffScreen />);

    await waitFor(() =>
      expect(getByTestId(`household-time-off-${TIME_OFF_ID}`)).toBeTruthy()
    );
    fireEvent.press(getByTestId(`household-time-off-${TIME_OFF_ID}`));

    await waitFor(() =>
      expect(getByTestId('pto-mark-paid-hours-input')).toBeTruthy()
    );
    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '8');
    fireEvent.press(getByTestId('pto-mark-paid-submit'));

    await waitFor(() =>
      expect(markPaidMock).toHaveBeenCalledWith(HOUSEHOLD_ID, {
        time_off_id: TIME_OFF_ID,
        minutes: 480,
      })
    );
  });

  it('a non-parent (nanny) viewer sees the rows but cannot open the mark-paid sheet', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([{ ...nannyMember, user_id: NANNY_ID }])
    );
    useAuthStore.setState({
      session: { user: { id: NANNY_ID } } as unknown as never,
      user: { id: NANNY_ID } as unknown as never,
      isInitialized: true,
    } as never);

    const { getByTestId, queryByTestId } = renderWithProviders(
      <HouseholdTimeOffScreen />
    );

    await waitFor(() =>
      expect(getByTestId(`household-time-off-${TIME_OFF_ID}`)).toBeTruthy()
    );
    fireEvent.press(getByTestId(`household-time-off-${TIME_OFF_ID}`));
    expect(queryByTestId('pto-mark-paid-hours-input')).toBeNull();
  });

  it('a REMOVED parent (past member) sees the rows but cannot open the mark-paid sheet', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([{ ...parentMembership, status: 'removed' }])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <HouseholdTimeOffScreen />
    );

    await waitFor(() =>
      expect(getByTestId(`household-time-off-${TIME_OFF_ID}`)).toBeTruthy()
    );
    fireEvent.press(getByTestId(`household-time-off-${TIME_OFF_ID}`));
    expect(queryByTestId('pto-mark-paid-hours-input')).toBeNull();
  });

  it('empty: shows the empty state', async () => {
    listForHouseholdMock.mockImplementation(() => Promise.resolve([]));

    const { getByTestId } = renderWithProviders(<HouseholdTimeOffScreen />);

    await waitFor(() =>
      expect(getByTestId('household-time-off-empty')).toBeTruthy()
    );
  });
});
