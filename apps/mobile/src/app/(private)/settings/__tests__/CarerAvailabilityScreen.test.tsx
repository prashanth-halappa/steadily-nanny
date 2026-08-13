/**
 * @module app/(private)/settings/__tests__/CarerAvailabilityScreen.test
 *
 * Regression: `GET /households/:id/members` now returns candidate rows.
 * This screen must resolve an active carer for availability, not whichever
 * nanny/helper appears first in the payload.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  HOUSEHOLD_MEMBER_STATUSES,
  type HouseholdMember,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

let CarerAvailabilityScreen: typeof import('../carer-availability').default;

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: mock(),
    back: mock(),
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

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_NANNY_ID = '33333333-3333-4333-8333-333333333333';
const ACTIVE_NANNY_ID = '44444444-4444-4444-8444-444444444444';
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
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: PARENT_ID,
  created_at: now,
  updated_at: now,
};

function buildMember(
  overrides: Pick<HouseholdMember, 'id' | 'user_id' | 'role' | 'status'>
): HouseholdMember {
  return {
    household_id: HOUSEHOLD_ID,
    can_edit: false,
    display_name_override: null,
    profile_name: null,
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const candidateNanny = buildMember({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user_id: CANDIDATE_NANNY_ID,
  role: 'nanny',
  status: HOUSEHOLD_MEMBER_STATUSES.CANDIDATE,
});

const activeNanny = buildMember({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  user_id: ACTIVE_NANNY_ID,
  role: 'nanny',
  status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
});

const listMock = mock(() => Promise.resolve([household]));
const listMembersMock = mock<() => Promise<HouseholdMember[]>>(() =>
  Promise.resolve([candidateNanny, activeNanny])
);
const getForUserMock = mock(() => Promise.resolve([]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: listMock, listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/availability', () => ({
  availabilityApi: { getForUser: getForUserMock },
}));

beforeAll(async () => {
  CarerAvailabilityScreen = (await import('../carer-availability')).default;
});

beforeEach(() => {
  listMock.mockReset();
  listMembersMock.mockReset();
  getForUserMock.mockReset();

  listMock.mockImplementation(() => Promise.resolve([household]));
  listMembersMock.mockImplementation(() =>
    Promise.resolve([candidateNanny, activeNanny])
  );
  getForUserMock.mockImplementation(() => Promise.resolve([]));

  useAuthStore.setState({
    session: { user: { id: PARENT_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('carer-availability route', () => {
  it('resolves the active nanny when a candidate nanny appears first in members', async () => {
    renderWithProviders(<CarerAvailabilityScreen />);

    await waitFor(() => {
      expect(getForUserMock).toHaveBeenCalledWith(ACTIVE_NANNY_ID);
    });
    expect(getForUserMock).not.toHaveBeenCalledWith(CANDIDATE_NANNY_ID);
  });
});
