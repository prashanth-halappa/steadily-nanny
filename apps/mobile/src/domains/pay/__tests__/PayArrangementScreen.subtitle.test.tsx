/**
 * @module domains/pay/__tests__/PayArrangementScreen.subtitle
 *
 * Pins the multi-carer subtitle fork: with 2+ active carers the screen must
 * NOT claim "you both see" (rates are per-carer; a nanny cannot read
 * another's). Uses the already-seeded `subtitleMultiCarer` key.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

let PayArrangementScreen: typeof import('../components/PayArrangementScreen').PayArrangementScreen;

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
const NANNY_A_ID = 'nanny-a';
const NANNY_B_ID = 'nanny-b';
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

function nannyMember(userId: string, name: string) {
  return {
    id: `member-${userId}`,
    household_id: HOUSEHOLD_ID,
    user_id: userId,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: name,
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
  };
}

const listMock = mock(() => Promise.resolve([baseHousehold]));
const listMembersMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([nannyMember(NANNY_A_ID, 'Priya')])
);
const membershipsListMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([parentMembership])
);
const payCurrentMock = mock(() => Promise.resolve(null));
const payHistoryMock = mock(() => Promise.resolve([]));
const listAcksMock = mock(() => Promise.resolve([]));

let searchParams: { carerId?: string } = {};

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: mock(),
    back: mock(),
    navigate: mock(),
  }),
  useLocalSearchParams: () => searchParams,
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
mock.module('@/src/hooks/queries/useTermsProposals', () => ({
  useTermsProposals: () => ({
    data: [],
    isPending: false,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
  findOpenTermsProposal: () => undefined,
}));
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: payCurrentMock,
    getHistory: payHistoryMock,
    create: mock(),
    listAcks: listAcksMock,
    ack: mock(),
    dissent: mock(),
    cancelScheduled: mock(),
  },
}));
mock.module('@/src/api/endpoints/termsProposals', () => ({
  termsProposalApi: {
    propose: mock(),
    withdraw: mock(),
    list: mock(() => Promise.resolve([])),
  },
}));
mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: { getBalance: mock(() => Promise.resolve(null)) },
}));

beforeAll(async () => {
  PayArrangementScreen = (await import('../components/PayArrangementScreen'))
    .PayArrangementScreen;
});

beforeEach(() => {
  listMock.mockReset();
  listMembersMock.mockReset();
  membershipsListMock.mockReset();
  payCurrentMock.mockReset();
  payHistoryMock.mockReset();
  listAcksMock.mockReset();
  searchParams = {};

  listMock.mockImplementation(() => Promise.resolve([baseHousehold]));
  listMembersMock.mockImplementation(() =>
    Promise.resolve([nannyMember(NANNY_A_ID, 'Priya')])
  );
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([parentMembership])
  );
  payCurrentMock.mockImplementation(() => Promise.resolve(null));
  payHistoryMock.mockImplementation(() => Promise.resolve([]));
  listAcksMock.mockImplementation(() => Promise.resolve([]));

  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    user: { id: PARENT_USER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('PayArrangementScreen subtitle (multi-carer privacy)', () => {
  it('one active carer: keeps pay:subtitle ("you both see")', async () => {
    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-arrangement-subtitle')).toBeTruthy()
    );
    expect(getByTestId('pay-arrangement-subtitle').props.children).toBe(
      'subtitle'
    );
  });

  it('two or more active carers: uses pay:subtitleMultiCarer, not the shared-view claim', async () => {
    listMembersMock.mockImplementation(() =>
      Promise.resolve([
        nannyMember(NANNY_A_ID, 'Priya'),
        nannyMember(NANNY_B_ID, 'Amara'),
      ])
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-arrangement-subtitle')).toBeTruthy()
    );
    expect(getByTestId('pay-arrangement-subtitle').props.children).toBe(
      'subtitleMultiCarer'
    );
  });
});
