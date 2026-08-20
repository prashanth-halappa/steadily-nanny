/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.closedHousehold.test
 *
 * When the shift's household has closed (the reader's `household_members`
 * row flipped to `removed`), every write action on this screen must stay
 * VISIBLE and go disabled with the shared reason (`common:householdClosedReason`)
 * — never hidden (S4 §7). `useCanWriteHousehold` is a SECOND, orthogonal gate
 * from `useRestrictedAction` (owner_only approval mode): a removed member's
 * row keeps its `role`, so the existing role-based rendering alone would
 * still show every action as live after the household closes.
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
let mockUseShiftChangeRequests: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseAuthStore: ReturnType<typeof mock>;
let mockUseCanWriteHousehold: ReturnType<typeof mock>;
let mockAcceptMutateAsync: ReturnType<typeof mock>;
let mockUpdateMutateAsync: ReturnType<typeof mock>;
let mockRespondMutateAsync: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';
const PARENT_ID = '77777777-7777-4777-8777-777777777777';
const CHANGE_REQUEST_ID = '99999999-9999-4999-8999-999999999999';

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

const confirmedShift = { ...pendingParentProposed, status: 'confirmed' };

const pendingChangeRequest = {
  id: CHANGE_REQUEST_ID,
  shift_id: SHIFT_ID,
  kind: 'counter_offer',
  status: 'pending',
  requested_by: CARER_ID,
  responded_by: null,
  message: null,
  response_message: null,
  proposed_starts_at: null,
  proposed_ends_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
};

const carerOnboarding = {
  role: 'nanny',
  status: 'onboarded',
  membershipRole: 'nanny',
  householdId: HOUSEHOLD_ID,
};
const parentOnboarding = {
  role: 'parent',
  status: 'onboarded',
  membershipRole: 'owner',
  householdId: HOUSEHOLD_ID,
};

const asCarer = () =>
  mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_ID } } })
  );
const asParent = () =>
  mockUseAuthStore.mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: PARENT_ID } } })
  );

const CLOSED = { canWrite: false, isPastMember: true, isLoading: false };
const OPEN = { canWrite: true, isPastMember: false, isLoading: false };
// `t()` echoes the raw (namespaced) key in this test harness — the same
// convention every other ShiftDetailScreen test in this directory follows
// (e.g. `expect(getByText('detail.freshProposalAwaitingCarer'))`).
const CLOSED_REASON = 'common:householdClosedReason';

beforeAll(async () => {
  mockUseShift = mock(() => ({
    data: pendingParentProposed,
    isLoading: false,
  }));
  mockUseShiftChangeRequests = mock(() => ({ data: [], isLoading: false }));
  mockUseIsOnboarded = mock(() => carerOnboarding);
  mockUseAuthStore = mock((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_ID } } })
  );
  mockUseCanWriteHousehold = mock(() => OPEN);
  mockAcceptMutateAsync = mock(() => Promise.resolve({}));
  mockUpdateMutateAsync = mock(() => Promise.resolve(pendingParentProposed));
  mockRespondMutateAsync = mock(() => Promise.resolve({}));

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
    useCanWriteHousehold: mockUseCanWriteHousehold,
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
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
      mutateAsync: mockUpdateMutateAsync,
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
      mutateAsync: mockRespondMutateAsync,
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
  mock.module('@/src/store/auth', () => ({ useAuthStore: mockUseAuthStore }));
  mock.module('@/src/lib/toast', () => ({ showSuccessToast: mock() }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockUseShift.mockImplementation(() => ({
    data: pendingParentProposed,
    isLoading: false,
  }));
  mockUseShiftChangeRequests.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));
  mockUseIsOnboarded.mockImplementation(() => carerOnboarding);
  mockUseCanWriteHousehold.mockImplementation(() => OPEN);
  asCarer();
  mockAcceptMutateAsync.mockClear();
  mockUpdateMutateAsync.mockClear();
  mockRespondMutateAsync.mockClear();
});

describe('ShiftDetailScreen — closed household', () => {
  it('disables Accept/Decline/Counter with the shared reason for the assigned carer, without hiding them', () => {
    mockUseCanWriteHousehold.mockImplementation(() => CLOSED);

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-accept').props.disabled).toBe(true);
    expect(getByTestId('shift-detail-accept-reason').props.children).toBe(
      CLOSED_REASON
    );
    expect(getByTestId('shift-detail-decline').props.disabled).toBe(true);
    expect(getByTestId('shift-detail-decline-reason').props.children).toBe(
      CLOSED_REASON
    );
    expect(getByTestId('shift-detail-counter').props.disabled).toBe(true);
    expect(getByTestId('shift-detail-counter-reason').props.children).toBe(
      CLOSED_REASON
    );
  });

  it('Accept/Decline/Counter behave normally when the household is open', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-accept').props.disabled).toBe(false);
    expect(queryByTestId('shift-detail-accept-reason')).toBeNull();

    fireEvent.press(getByTestId('shift-detail-accept'));
    expect(mockAcceptMutateAsync).toHaveBeenCalledWith({ shiftId: SHIFT_ID });
  });

  it('disables Save and Cancel with the shared reason for the parent, without hiding them', () => {
    mockUseIsOnboarded.mockImplementation(() => parentOnboarding);
    asParent();
    mockUseCanWriteHousehold.mockImplementation(() => CLOSED);

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-save').props.disabled).toBe(true);
    expect(getByTestId('shift-detail-save-reason').props.children).toBe(
      CLOSED_REASON
    );
    expect(getByTestId('shift-detail-cancel').props.disabled).toBe(true);
    expect(getByTestId('shift-detail-cancel-reason').props.children).toBe(
      CLOSED_REASON
    );
  });

  it('Save behaves normally for the parent when the household is open', () => {
    mockUseIsOnboarded.mockImplementation(() => parentOnboarding);
    asParent();

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-save').props.disabled).toBe(false);
    expect(queryByTestId('shift-detail-save-reason')).toBeNull();
  });

  it('disables Accept/Decline change-request buttons with the shared reason for the parent responding to the carer’s request', () => {
    mockUseIsOnboarded.mockImplementation(() => parentOnboarding);
    asParent();
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [pendingChangeRequest],
      isLoading: false,
    }));
    mockUseCanWriteHousehold.mockImplementation(() => CLOSED);

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(
      getByTestId(`shift-change-accept-${CHANGE_REQUEST_ID}`).props.disabled
    ).toBe(true);
    expect(
      getByTestId(`shift-change-accept-${CHANGE_REQUEST_ID}-reason`).props
        .children
    ).toBe(CLOSED_REASON);
    expect(
      getByTestId(`shift-change-decline-${CHANGE_REQUEST_ID}`).props.disabled
    ).toBe(true);
  });

  it('disables the Withdraw change-request button with the shared reason for its own requester', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [pendingChangeRequest],
      isLoading: false,
    }));
    mockUseCanWriteHousehold.mockImplementation(() => CLOSED);
    // Carer is the requester of `pendingChangeRequest` (requested_by: CARER_ID).
    asCarer();

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(
      getByTestId(`shift-change-withdraw-${CHANGE_REQUEST_ID}`).props.disabled
    ).toBe(true);
    expect(
      getByTestId(`shift-change-withdraw-${CHANGE_REQUEST_ID}-reason`).props
        .children
    ).toBe(CLOSED_REASON);
  });

  it('does not show the closed reason while useCanWriteHousehold is still loading (fails toward wait, not a premature claim)', () => {
    mockUseCanWriteHousehold.mockImplementation(() => ({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    // Disabled while unresolved (own-reason, not a restriction claim)...
    expect(getByTestId('shift-detail-accept').props.disabled).toBe(true);
    // ...but no closure sentence is asserted before it's confirmed.
    expect(queryByTestId('shift-detail-accept-reason')).toBeNull();
  });
});
