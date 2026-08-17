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
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

let CarerAvailabilityScreen: typeof import('../carer-availability').default;

// The global preload's `t` echoes the bare key and drops interpolation
// options; the summary assertion needs days/hours visible in the text.
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

function buildAvailabilityRow(
  weekday: number,
  earliest_start: string,
  latest_finish: string
) {
  return {
    id: `00000000-0000-4000-8000-${String(weekday).padStart(12, '0')}`,
    user_id: ACTIVE_NANNY_ID,
    weekday,
    is_available: true,
    earliest_start,
    latest_finish,
    evening_mode: 'sometimes',
    created_at: now,
    updated_at: now,
  };
}

/** Mon–Fri, 09:00–17:00 → 5 days, 40 weekly hours. */
const weekdayWindows = [1, 2, 3, 4, 5].map(day =>
  buildAvailabilityRow(day, '09:00', '17:00')
);

const listMock = mock(() => Promise.resolve([household]));
const listMembersMock = mock<() => Promise<HouseholdMember[]>>(() =>
  Promise.resolve([candidateNanny, activeNanny])
);
const getForUserMock = mock<() => Promise<typeof weekdayWindows>>(() =>
  Promise.resolve([])
);

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

  it('summarises the days worked and the weekly hours', async () => {
    getForUserMock.mockImplementation(() => Promise.resolve(weekdayWindows));

    const { getByTestId } = renderWithProviders(<CarerAvailabilityScreen />);

    await waitFor(() =>
      expect(getByTestId('carer-availability-summary')).toBeTruthy()
    );
    expect(getByTestId('carer-availability-summary').props.children).toBe(
      'carerAvailabilitySummary({"days":5,"hours":40})'
    );
  });

  it('renders no summary when the carer has set no availability', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <CarerAvailabilityScreen />
    );

    await waitFor(() =>
      expect(getByTestId('carer-availability-none')).toBeTruthy()
    );
    expect(queryByTestId('carer-availability-summary')).toBeNull();
  });
});

// False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): `members`/
// `availability` failing fell through the same `?? []` a genuinely-empty
// read does, claiming "no carer to show" or "hasn't set availability" over
// a household with an active nanny who HAS set it.
describe('carer-availability route — a failed read', () => {
  it('renders ErrorState, never "no carer" empty state, when members fails', async () => {
    listMembersMock.mockImplementation(() =>
      Promise.reject(new Error('members boom'))
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <CarerAvailabilityScreen />
    );

    await waitFor(() => expect(getByTestId('error-state')).toBeTruthy());
    expect(queryByTestId('carer-availability-empty')).toBeNull();
  });

  it('renders ErrorState, never "hasn\'t set availability", when the availability read fails', async () => {
    getForUserMock.mockImplementation(() =>
      Promise.reject(new Error('availability boom'))
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <CarerAvailabilityScreen />
    );

    await waitFor(() => expect(getByTestId('error-state')).toBeTruthy());
    expect(queryByTestId('carer-availability-none')).toBeNull();
  });

  it('retrying refetches both members and availability', async () => {
    getForUserMock.mockImplementation(() =>
      Promise.reject(new Error('availability boom'))
    );

    const { getByTestId, getByText } = renderWithProviders(
      <CarerAvailabilityScreen />
    );

    await waitFor(() => expect(getByTestId('error-state')).toBeTruthy());
    listMembersMock.mockClear();
    getForUserMock.mockClear();

    fireEvent.press(getByText('tryAgain'));

    await waitFor(() => expect(getForUserMock).toHaveBeenCalled());
    expect(listMembersMock).toHaveBeenCalled();
  });
});
