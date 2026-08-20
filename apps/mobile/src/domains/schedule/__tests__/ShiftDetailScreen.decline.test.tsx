/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.decline.test
 *
 * Assigned carer can Decline a pending shift, beside Accept, behind an
 * alert-dialog confirm. Mirrors ShiftDetailScreen.accept.test.tsx's shape.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
let mockUseShiftEvents: ReturnType<typeof mock>;
let mockUseShiftChangeRequests: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseAuthStore: ReturnType<typeof mock>;
let mockDeclineMutateAsync: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_USER_ID = '66666666-6666-4666-8666-666666666666';

const pendingParentProposed = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
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
  ical_uid: 'shift-1@steadily',
  sequence: 0,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

beforeAll(async () => {
  mockUseShift = mock(() => ({
    data: pendingParentProposed,
    isLoading: false,
  }));
  mockUseShiftEvents = mock(() => ({ data: [], isLoading: false }));
  mockUseShiftChangeRequests = mock(() => ({ data: [], isLoading: false }));
  mockUseIsOnboarded = mock(() => ({
    role: 'nanny',
    status: 'onboarded',
    // Pattern A: the screen resolves the role against the SHIFT's
    // household, so these two must be present for it to land here.
    membershipRole: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseAuthStore = mock((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_ID } } })
  );
  mockDeclineMutateAsync = mock(() =>
    Promise.resolve({ ...pendingParentProposed, status: 'declined' })
  );

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: mockUseShift,
  }));
  // S3/S4 (3-T3): the screen now reads the carer's arrangement for the
  // cancel dialog's pay sentence and the household for the co-parent
  // restricted state. Stubbed here so this suite keeps testing its own
  // subject — see ShiftDetailScreen.cancelPay.test.tsx for their behaviour.
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
    useShiftEvents: mockUseShiftEvents,
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: mockUseShiftChangeRequests,
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
    useHouseholdMembers: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: () => ({
      mutateAsync: mock(() => Promise.resolve(pendingParentProposed)),
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
      mutateAsync: mockDeclineMutateAsync,
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
  mockUseShift.mockImplementation(() => ({
    data: pendingParentProposed,
    isLoading: false,
  }));
  mockUseIsOnboarded.mockImplementation(() => ({
    role: 'nanny',
    status: 'onboarded',
    // Pattern A: the screen resolves the role against the SHIFT's
    // household, so these two must be present for it to land here.
    membershipRole: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_ID } } })
  );
  mockDeclineMutateAsync.mockClear();
});

describe('ShiftDetailScreen decline', () => {
  it('shows Decline beside Accept for the assigned carer on a pending shift', () => {
    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-accept')).toBeTruthy();
    expect(getByTestId('shift-detail-decline')).toBeTruthy();
  });

  it('hides Decline for a parent viewer', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
      membershipRole: 'owner',
      householdId: HOUSEHOLD_ID,
    }));
    mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: OTHER_USER_ID } } })
    );

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-decline')).toBeNull();
  });

  it('hides Decline when the shift is already confirmed', () => {
    mockUseShift.mockImplementation(() => ({
      data: { ...pendingParentProposed, status: 'confirmed' },
      isLoading: false,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-decline')).toBeNull();
  });

  it('does not call useDeclineShift until the confirm dialog is confirmed', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-decline'));

    expect(queryByTestId('shift-detail-decline-confirm')).toBeTruthy();
    expect(mockDeclineMutateAsync).not.toHaveBeenCalled();
  });

  it('calls useDeclineShift on confirm', async () => {
    const { getByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-decline'));
    fireEvent.press(getByTestId('shift-detail-decline-confirm'));

    await waitFor(() =>
      expect(mockDeclineMutateAsync).toHaveBeenCalledWith({
        shiftId: SHIFT_ID,
      })
    );
  });

  it('dismisses the confirm dialog on cancel without calling the mutation', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-decline'));
    fireEvent.press(getByTestId('shift-detail-decline-cancel'));

    expect(mockDeclineMutateAsync).not.toHaveBeenCalled();
  });
});
