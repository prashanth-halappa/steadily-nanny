/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.crossFamilyClash.test
 *
 * S4b — the shift-scoped day thread renders a `cross_family_clash` event
 * with DIFFERENT copy per role (docs/design/screens-schedule.md): the parent
 * hears whose shift overlaps; the nanny hears that it overlaps another
 * family's, never which one (016_calendar_seams.sql's privacy discipline —
 * the event payload itself never names the other household).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

let ShiftDetailScreen: typeof import('../components/ShiftDetailScreen').ShiftDetailScreen;
let mockUseHouseholdMembers: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseAuthStore: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_ID = '55555555-5555-4555-8555-555555555555';
const PARENT_ID = '66666666-6666-4666-8666-666666666666';

const confirmedShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: NANNY_ID,
  starts_at: '2026-08-03T13:00:00.000Z',
  ends_at: '2026-08-03T21:00:00.000Z',
  timezone: 'America/New_York',
  local_date: '2026-08-03',
  kind: 'recurring',
  status: 'confirmed',
  source_pattern_id: null,
  origin: 'system_generated',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  cover_ask_expires_at: null,
  ical_uid: 'shift-clash@steadily',
  sequence: 0,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

const clashEvent = {
  id: 'evt-clash-1',
  household_id: HOUSEHOLD_ID,
  shift_id: SHIFT_ID,
  local_date: '2026-08-03',
  actor_id: null,
  event_type: 'cross_family_clash',
  payload: {
    key: `${SHIFT_ID}|other-uid`,
    kind: 'other_commitment',
    other_source_uid: 'other-uid',
    other_starts_at: '2026-08-03T14:00:00.000Z',
    other_ends_at: '2026-08-03T22:00:00.000Z',
  },
  created_at: '2026-08-02T00:00:00.000Z',
};

const memberRow = (
  role: 'owner' | 'parent' | 'nanny' | 'helper',
  userId: string
) => ({
  id: `member-${role}`,
  household_id: HOUSEHOLD_ID,
  user_id: userId,
  role,
  status: 'active',
  display_name_override: null,
  profile_name: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
});

const onboardedInShiftHousehold = {
  status: 'onboarded',
  householdId: HOUSEHOLD_ID,
  householdState: 'live',
  isPastMember: false,
  membershipsError: false,
  retryMemberships: () => {},
};

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: () => ({
      data: confirmedShift,
      isLoading: false,
      isError: false,
      refetch: mock(),
    }),
  }));
  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: () => ({ data: null, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useHouseholds', () => ({
    useHouseholds: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: () => ({ disabled: false, reason: null }),
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [clashEvent], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: () => ({ data: [], isLoading: false }),
  }));
  mockUseIsOnboarded = mock(() => onboardedInShiftHousehold);
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }),
  }));
  mockUseHouseholdMembers = mock(() => ({
    data: [memberRow('nanny', NANNY_ID), memberRow('parent', PARENT_ID)],
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: () => ({
      mutateAsync: mock(() => Promise.resolve(confirmedShift)),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateShiftChangeRequest', () => ({
    useCreateShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRespondToShiftChangeRequest', () => ({
    useRespondToShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useAcceptShift', () => ({
    useAcceptShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useDeclineShift', () => ({
    useDeclineShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawChangeRequest', () => ({
    useWithdrawChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mockUseAuthStore = mock((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: PARENT_ID } } })
  );
  mock.module('@/src/store/auth', () => ({ useAuthStore: mockUseAuthStore }));
  mock.module('@/src/lib/toast', () => ({ showSuccessToast: mock() }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockUseHouseholdMembers.mockImplementation(() => ({
    data: [memberRow('nanny', NANNY_ID), memberRow('parent', PARENT_ID)],
    isLoading: false,
  }));
});

describe('ShiftDetailScreen — cross_family_clash thread event (S4b)', () => {
  it('tells the PARENT whose shift overlaps another commitment', () => {
    mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: PARENT_ID } } })
    );

    const { getByText, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByText('detail.eventType.crossFamilyClashParent')).toBeTruthy();
    // Never the generic "unknown event" fallback — this type is known.
    expect(queryByTestId(`shift-event-fallback-${clashEvent.id}`)).toBeNull();
  });

  it('tells the NANNY it overlaps a shift with another family — never which one', () => {
    mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: NANNY_ID } } })
    );

    const { getByText, queryByText } = render(<ShiftDetailScreen />);

    expect(getByText('detail.eventType.crossFamilyClashNanny')).toBeTruthy();
    expect(queryByText('detail.eventType.crossFamilyClashParent')).toBeNull();
  });
});
