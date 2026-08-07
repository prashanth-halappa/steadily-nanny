/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.accept.test
 *
 * Assigned carer can Accept a pending shift; parent / wrong carer cannot.
 * Fresh extra proposals (pending + parent_proposed + kind=extra +
 * source_pattern_id=null + sequence===0) get proposal copy; demoted
 * recurring/cover or re-timed extras (sequence>0) get re-confirm copy.
 * Accept mutation fires on press.
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
let mockUseShiftEvents: ReturnType<typeof mock>;
let mockUseShiftChangeRequests: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseAuthStore: ReturnType<typeof mock>;
let mockAcceptMutateAsync: ReturnType<typeof mock>;

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
  }));
  mockUseAuthStore = mock((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_ID } } })
  );
  mockAcceptMutateAsync = mock(() =>
    Promise.resolve({ ...pendingParentProposed, status: 'confirmed' })
  );

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: mockUseShift,
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
      mutateAsync: mockAcceptMutateAsync,
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
  mockUseShift.mockImplementation(() => ({
    data: pendingParentProposed,
    isLoading: false,
  }));
  mockUseIsOnboarded.mockImplementation(() => ({
    role: 'nanny',
    status: 'onboarded',
  }));
  mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_ID } } })
  );
  mockAcceptMutateAsync.mockClear();
});

describe('ShiftDetailScreen accept + reconfirm', () => {
  it('shows Accept for the assigned carer on a pending shift', () => {
    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-accept')).toBeTruthy();
    expect(getByTestId('shift-detail-counter')).toBeTruthy();
  });

  it('hides Accept for a parent viewer', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: OTHER_USER_ID } } })
    );

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-accept')).toBeNull();
  });

  it('hides Accept for a nanny who is not the assigned carer', () => {
    mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: OTHER_USER_ID } } })
    );

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-accept')).toBeNull();
  });

  it('hides Accept when the shift is already confirmed', () => {
    mockUseShift.mockImplementation(() => ({
      data: { ...pendingParentProposed, status: 'confirmed' },
      isLoading: false,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-accept')).toBeNull();
  });

  it('calls useAcceptShift on Accept press', () => {
    const { getByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-accept'));

    expect(mockAcceptMutateAsync).toHaveBeenCalledWith({ shiftId: SHIFT_ID });
  });

  it('shows proposal copy for a fresh extra (pending + parent_proposed + sequence===0), not reconfirm', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-fresh-proposal')).toBeTruthy();
    expect(queryByTestId('shift-detail-needs-reconfirm')).toBeNull();
  });

  // Case (c): migration 034 demotes by bumping sequence only — kind stays
  // extra and source_pattern_id stays null. Must show re-confirm, not
  // "new shift proposed".
  it('shows re-confirm copy for a re-timed extra (pending + parent_proposed + sequence>0)', () => {
    mockUseShift.mockImplementation(() => ({
      data: {
        ...pendingParentProposed,
        kind: 'extra',
        source_pattern_id: null,
        sequence: 1,
      },
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-needs-reconfirm')).toBeTruthy();
    expect(queryByTestId('shift-detail-fresh-proposal')).toBeNull();
  });

  it('shows re-confirm copy for a demoted recurring shift (pending + parent_proposed)', () => {
    mockUseShift.mockImplementation(() => ({
      data: {
        ...pendingParentProposed,
        kind: 'recurring',
        source_pattern_id: '77777777-7777-4777-8777-777777777777',
      },
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-needs-reconfirm')).toBeTruthy();
    expect(queryByTestId('shift-detail-fresh-proposal')).toBeNull();
  });

  it('hides re-confirm and proposal copy when pending but origin is system_generated', () => {
    mockUseShift.mockImplementation(() => ({
      data: {
        ...pendingParentProposed,
        origin: 'system_generated',
        kind: 'recurring',
        source_pattern_id: '77777777-7777-4777-8777-777777777777',
      },
      isLoading: false,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-needs-reconfirm')).toBeNull();
    expect(queryByTestId('shift-detail-fresh-proposal')).toBeNull();
  });

  it('hides re-confirm and proposal copy when confirmed even if origin is parent_proposed', () => {
    mockUseShift.mockImplementation(() => ({
      data: { ...pendingParentProposed, status: 'confirmed' },
      isLoading: false,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId('shift-detail-needs-reconfirm')).toBeNull();
    expect(queryByTestId('shift-detail-fresh-proposal')).toBeNull();
  });
});
