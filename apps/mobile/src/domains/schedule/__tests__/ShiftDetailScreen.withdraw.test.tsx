/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.withdraw.test
 *
 * Defect fix: the requester's OWN pending change request must show a
 * Withdraw button, not accept/decline (those stay for the OTHER side). The
 * inbox already filters this correctly via `requested_by !== me`; this is
 * the schedule-side surface — see ShiftDetailScreen.responded.test.tsx for
 * the sibling coverage that a non-requester still sees accept/decline.
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
let mockUseShiftChangeRequests: ReturnType<typeof mock>;
let mockWithdrawMutateAsync: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const ME_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

const baseShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: OTHER_ID,
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
  ical_uid: 'shift-1@steadily',
  sequence: 0,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

function makeChangeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: REQUEST_ID,
    shift_id: SHIFT_ID,
    requested_by: ME_ID,
    kind: 'cancel',
    proposed_starts_at: null,
    proposed_ends_at: null,
    message: 'Please cancel',
    response_message: null,
    status: 'pending',
    responded_by: null,
    responded_at: null,
    created_at: '2026-08-02T10:00:00.000Z',
    updated_at: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  mockUseShift = mock(() => ({ data: baseShift, isLoading: false }));
  mockUseShiftChangeRequests = mock(() => ({
    data: [makeChangeRequest()],
    isLoading: false,
  }));
  mockWithdrawMutateAsync = mock(() =>
    Promise.resolve({ ...makeChangeRequest(), status: 'withdrawn' })
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
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: mockUseShiftChangeRequests,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ role: 'parent', status: 'onboarded' }),
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
      mutateAsync: mock(() => Promise.resolve(baseShift)),
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
      mutateAsync: mockWithdrawMutateAsync,
      isPending: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: ME_ID } } }),
  }));
  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockUseShift.mockImplementation(() => ({
    data: baseShift,
    isLoading: false,
  }));
  mockUseShiftChangeRequests.mockImplementation(() => ({
    data: [makeChangeRequest()],
    isLoading: false,
  }));
  mockWithdrawMutateAsync.mockClear();
});

describe('ShiftDetailScreen — requester sees Withdraw, not accept/decline', () => {
  it('shows Withdraw (not accept/decline) for the requester on her own pending request', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId(`shift-change-withdraw-${REQUEST_ID}`)).toBeTruthy();
    expect(queryByTestId(`shift-change-accept-${REQUEST_ID}`)).toBeNull();
    expect(queryByTestId(`shift-change-decline-${REQUEST_ID}`)).toBeNull();
  });

  it('shows accept/decline (not Withdraw) when someone else raised the pending request', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [makeChangeRequest({ requested_by: OTHER_ID })],
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId(`shift-change-accept-${REQUEST_ID}`)).toBeTruthy();
    expect(getByTestId(`shift-change-decline-${REQUEST_ID}`)).toBeTruthy();
    expect(queryByTestId(`shift-change-withdraw-${REQUEST_ID}`)).toBeNull();
  });

  it('does not call useWithdrawChangeRequest until the confirm dialog is confirmed', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId(`shift-change-withdraw-${REQUEST_ID}`));

    expect(
      queryByTestId(`shift-change-withdraw-confirm-${REQUEST_ID}`)
    ).toBeTruthy();
    expect(mockWithdrawMutateAsync).not.toHaveBeenCalled();
  });

  it('calls useWithdrawChangeRequest with the request id on confirm', async () => {
    const { getByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId(`shift-change-withdraw-${REQUEST_ID}`));
    fireEvent.press(getByTestId(`shift-change-withdraw-confirm-${REQUEST_ID}`));

    await waitFor(() =>
      expect(mockWithdrawMutateAsync).toHaveBeenCalledWith(REQUEST_ID)
    );
  });

  it('renders an expired request as an ended state — no action buttons at all', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [makeChangeRequest({ status: 'expired' })],
      isLoading: false,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId(`shift-change-withdraw-${REQUEST_ID}`)).toBeNull();
    expect(queryByTestId(`shift-change-accept-${REQUEST_ID}`)).toBeNull();
    expect(queryByTestId(`shift-change-decline-${REQUEST_ID}`)).toBeNull();
    expect(queryByTestId(`shift-change-awaiting-${REQUEST_ID}`)).toBeNull();
  });
});
