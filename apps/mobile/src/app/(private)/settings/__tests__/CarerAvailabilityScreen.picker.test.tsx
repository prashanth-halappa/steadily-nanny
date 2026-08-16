/**
 * @module app/(private)/settings/__tests__/CarerAvailabilityScreen.picker.test
 *
 * Direction §5 / S9 item 3: with TWO active carers, `find()` picked
 * whichever came first in the members payload and never said whose
 * availability was on screen. This pins the fix: an explicit `?carerId=`
 * disambiguates, and the empty state names the resolved person instead of
 * a generic "your nanny".
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
let mockSearchParams: { carerId?: string } = {};

// The global preload's `t` echoes the bare key and drops interpolation
// options, so the "names the person" assertion needs its own override that
// keeps them visible (same trick as SendMyTermsCard.test.tsx).
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}(${JSON.stringify(opts)})` : key,
    i18n: { language: 'en', changeLanguage: mock() },
  }),
  initReactI18next: { type: '3rdParty', init: mock() },
}));

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: mock(),
    back: mock(),
    navigate: mock(),
  }),
  useLocalSearchParams: () => mockSearchParams,
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
const FIRST_NANNY_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_NANNY_ID = '44444444-4444-4444-8444-444444444444';
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
  overrides: Pick<
    HouseholdMember,
    'id' | 'user_id' | 'role' | 'status' | 'profile_name'
  >
): HouseholdMember {
  return {
    household_id: HOUSEHOLD_ID,
    can_edit: false,
    display_name_override: null,
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const firstNanny = buildMember({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user_id: FIRST_NANNY_ID,
  role: 'nanny',
  status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
  profile_name: 'Amara',
});

const secondNanny = buildMember({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  user_id: SECOND_NANNY_ID,
  role: 'nanny',
  status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
  profile_name: 'Priya',
});

const listMock = mock(() => Promise.resolve([household]));
const listMembersMock = mock<() => Promise<HouseholdMember[]>>(() =>
  Promise.resolve([firstNanny, secondNanny])
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
  mockSearchParams = {};
  listMock.mockReset();
  listMembersMock.mockReset();
  getForUserMock.mockReset();

  listMock.mockImplementation(() => Promise.resolve([household]));
  listMembersMock.mockImplementation(() =>
    Promise.resolve([firstNanny, secondNanny])
  );
  getForUserMock.mockImplementation(() => Promise.resolve([]));

  useAuthStore.setState({
    session: { user: { id: PARENT_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('carer-availability route — two active carers', () => {
  it('with no carerId, silently defaults to whichever active carer comes first (the pre-existing bug, now at least visible in the empty state)', async () => {
    renderWithProviders(<CarerAvailabilityScreen />);

    await waitFor(() => {
      expect(getForUserMock).toHaveBeenCalledWith(FIRST_NANNY_ID);
    });
  });

  it('with an explicit carerId, resolves THAT carer, not the first one in the payload', async () => {
    mockSearchParams = { carerId: SECOND_NANNY_ID };
    renderWithProviders(<CarerAvailabilityScreen />);

    await waitFor(() => {
      expect(getForUserMock).toHaveBeenCalledWith(SECOND_NANNY_ID);
    });
    expect(getForUserMock).not.toHaveBeenCalledWith(FIRST_NANNY_ID);
  });

  it('names the resolved carer in the empty state instead of a generic "your nanny"', async () => {
    mockSearchParams = { carerId: SECOND_NANNY_ID };
    const { findByText } = renderWithProviders(<CarerAvailabilityScreen />);

    expect(
      await findByText('carerAvailabilityNone({"name":"Priya"})')
    ).toBeTruthy();
  });
});
