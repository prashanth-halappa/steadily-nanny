/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.householdRole.test
 *
 * Pattern A (detail-screen half of the hybrid rule) + Pattern C (C4).
 *
 * 1. ROLE COMES FROM THE SHIFT'S HOUSEHOLD, not the switcher's active one.
 *    This screen is reached by `shiftId` alone (push, deep link), so a nanny
 *    holding two memberships who follows a push about family B while family A
 *    is selected used to be rendered with family A's role — parent edit
 *    fields on a shift she is the carer for, and no Accept.
 *
 * 2. C4 — a FAILED read is not "this shift doesn't exist" and not an endless
 *    spinner. `shiftQuery.isError` / `onboarding.membershipsError` both get an
 *    ErrorState with a working retry; only a SETTLED null shift keeps the
 *    notFound copy.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
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
let mockUseShift: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;
let mockUseAuthStore: ReturnType<typeof mock>;
let mockShiftRefetch: ReturnType<typeof mock>;
let mockRetryMemberships: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
/** The household the SHIFT belongs to. */
const SHIFT_HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
/** The household the SWITCHER currently has selected — a different family. */
const ACTIVE_HOUSEHOLD_ID = '33333333-3333-4333-8333-333333333333';
const READER_ID = '55555555-5555-4555-8555-555555555555';

const pendingShift = {
  id: SHIFT_ID,
  household_id: SHIFT_HOUSEHOLD_ID,
  carer_id: READER_ID,
  starts_at: '2026-08-03T13:00:00.000Z',
  ends_at: '2026-08-03T21:00:00.000Z',
  timezone: 'America/New_York',
  local_date: '2026-08-03',
  kind: 'extra',
  status: 'pending',
  source_pattern_id: null,
  origin: 'parent_proposed',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  cover_ask_expires_at: null,
  ical_uid: 'shift-role@steadily',
  sequence: 0,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

const memberRow = (role: 'owner' | 'parent' | 'nanny' | 'helper') => ({
  id: `member-${role}`,
  household_id: SHIFT_HOUSEHOLD_ID,
  user_id: READER_ID,
  role,
  status: 'active',
  display_name_override: null,
  profile_name: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
});

/** The switcher's active household says PARENT — the wrong answer here. */
const onboardedAsParentElsewhere = {
  status: 'onboarded',
  role: 'parent',
  membershipRole: 'owner',
  householdId: ACTIVE_HOUSEHOLD_ID,
  householdState: 'live',
  isPastMember: false,
  membershipsError: false,
  retryMemberships: () => {},
};

beforeAll(async () => {
  mockShiftRefetch = mock(() => Promise.resolve());
  mockRetryMemberships = mock(() => {});
  mockUseShift = mock(() => ({
    data: pendingShift,
    isLoading: false,
    isError: false,
    refetch: mockShiftRefetch,
  }));
  mockUseIsOnboarded = mock(() => ({
    ...onboardedAsParentElsewhere,
    retryMemberships: mockRetryMemberships,
  }));
  mockUseHouseholdMembers = mock(() => ({
    data: [memberRow('nanny')],
    isLoading: false,
  }));
  mockUseAuthStore = mock((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: READER_ID } } })
  );

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: mockUseShift,
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
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: () => ({
      mutateAsync: mock(() => Promise.resolve(pendingShift)),
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
  mock.module('@/src/store/auth', () => ({
    useAuthStore: mockUseAuthStore,
  }));
  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockShiftRefetch.mockClear();
  mockRetryMemberships.mockClear();
  mockUseShift.mockImplementation(() => ({
    data: pendingShift,
    isLoading: false,
    isError: false,
    refetch: mockShiftRefetch,
  }));
  mockUseIsOnboarded.mockImplementation(() => ({
    ...onboardedAsParentElsewhere,
    retryMemberships: mockRetryMemberships,
  }));
  mockUseHouseholdMembers.mockImplementation(() => ({
    data: [memberRow('nanny')],
    isLoading: false,
  }));
});

describe("ShiftDetailScreen — role comes from the SHIFT's household", () => {
  it('gives the carer affordances to a nanny in the shift household whose ACTIVE household says parent', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-readonly')).toBeTruthy();
    expect(getByTestId('shift-detail-counter-form')).toBeTruthy();
    expect(getByTestId('shift-detail-accept')).toBeTruthy();
    expect(queryByTestId('shift-detail-edit')).toBeNull();
  });

  it('MIRROR: gives the parent edit fields to a parent in the shift household whose ACTIVE household says nanny', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      ...onboardedAsParentElsewhere,
      role: 'nanny',
      membershipRole: 'nanny',
      retryMemberships: mockRetryMemberships,
    }));
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: [memberRow('parent')],
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-edit')).toBeTruthy();
    expect(queryByTestId('shift-detail-readonly')).toBeNull();
    expect(queryByTestId('shift-detail-accept')).toBeNull();
  });

  it('disables Accept/Decline WITH A REASON while the role in the shift household is unknown', () => {
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
    }));

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-accept').props.disabled).toBe(true);
    expect(getByTestId('shift-detail-decline').props.disabled).toBe(true);
    expect(
      String(getByTestId('shift-detail-accept-reason').props.children)
    ).toBe('detail.roleResolving');
    expect(getByTestId('shift-detail-decline-reason')).toBeTruthy();
  });

  // §5.3 must not regress: a withdrawn ask offers no answer form at all,
  // resolving role or not.
  it('§5.3: a withdrawn cover ask still renders no accept/decline form', () => {
    mockUseHouseholdMembers.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
    }));
    mockUseShift.mockImplementation(() => ({
      data: {
        ...pendingShift,
        status: 'cancelled',
        cancelled_by: '99999999-9999-4999-8999-999999999999',
      },
      isLoading: false,
      isError: false,
      refetch: mockShiftRefetch,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-counter-form')).toBeNull();
    expect(queryByTestId('shift-detail-accept')).toBeNull();
  });
});

describe('ShiftDetailScreen — C4 failed reads are not "missing" (Pattern C)', () => {
  it('renders an ErrorState with retry on shiftQuery.isError, not the notFound copy', () => {
    mockUseShift.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockShiftRefetch,
    }));

    const { getByTestId, queryByTestId, getByText, queryByText } = render(
      <ShiftDetailScreen />
    );

    expect(getByTestId('shift-detail-error')).toBeTruthy();
    expect(getByTestId('error-state')).toBeTruthy();
    expect(getByText('states.network.title')).toBeTruthy();
    expect(queryByText('states.notFound.title')).toBeNull();
    expect(queryByTestId('shift-detail-missing')).toBeNull();

    fireEvent.press(getByText('tryAgain'));
    expect(mockShiftRefetch).toHaveBeenCalledTimes(1);
  });

  it("a 404 read renders the notFound ErrorState, not 'No connection'", () => {
    mockUseShift.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { response: { status: 404 } },
      refetch: mockShiftRefetch,
    }));

    const { getByTestId, queryByTestId, getByText, queryByText } = render(
      <ShiftDetailScreen />
    );

    expect(getByTestId('shift-detail-error')).toBeTruthy();
    expect(getByTestId('error-state')).toBeTruthy();
    expect(getByText('states.notFound.title')).toBeTruthy();
    expect(queryByText('states.network.title')).toBeNull();
    expect(queryByTestId('shift-detail-missing')).toBeNull();
  });

  it('a 403 read renders the notFound ErrorState (never leaks whether the shift exists)', () => {
    mockUseShift.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { response: { status: 403 } },
      refetch: mockShiftRefetch,
    }));

    const { getByTestId, queryByTestId, getByText, queryByText } = render(
      <ShiftDetailScreen />
    );

    expect(getByTestId('shift-detail-error')).toBeTruthy();
    expect(getByTestId('error-state')).toBeTruthy();
    expect(getByText('states.notFound.title')).toBeTruthy();
    expect(queryByText('states.network.title')).toBeNull();
    expect(queryByTestId('shift-detail-missing')).toBeNull();
  });

  it('renders an ErrorState with retry on membershipsError, never an endless spinner', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      ...onboardedAsParentElsewhere,
      status: 'loading',
      role: null,
      membershipRole: null,
      householdId: null,
      membershipsError: true,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId, getByText } = render(
      <ShiftDetailScreen />
    );

    expect(getByTestId('shift-detail-error')).toBeTruthy();
    expect(queryByTestId('shift-detail-loading')).toBeNull();

    fireEvent.press(getByText('tryAgain'));
    expect(mockRetryMemberships).toHaveBeenCalledTimes(1);
  });

  it('keeps the notFound copy for a SETTLED null shift', () => {
    mockUseShift.mockImplementation(() => ({
      data: null,
      isLoading: false,
      isError: false,
      refetch: mockShiftRefetch,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-missing')).toBeTruthy();
    expect(queryByTestId('shift-detail-error')).toBeNull();
  });
});
