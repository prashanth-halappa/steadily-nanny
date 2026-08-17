/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.cancelConfirm.test
 *
 * The parent's "Request cancel" action used to fire a change request
 * unconfirmed. It now sits behind an alert-dialog confirm, same as the
 * decline-shift and withdraw-request confirms.
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
let mockCreateChangeMutateAsync: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

const confirmedShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: '55555555-5555-4555-8555-555555555555',
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

beforeAll(async () => {
  mockCreateChangeMutateAsync = mock(() => Promise.resolve({}));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: () => ({ data: confirmedShift, isLoading: false }),
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
    useShiftChangeRequests: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      role: 'parent',
      status: 'onboarded',
      // Pattern A: role is resolved against the SHIFT's household.
      membershipRole: 'owner',
      householdId: HOUSEHOLD_ID,
    }),
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
      mutateAsync: mock(() => Promise.resolve(confirmedShift)),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateShiftChangeRequest', () => ({
    useCreateShiftChangeRequest: () => ({
      mutateAsync: mockCreateChangeMutateAsync,
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
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: null }),
  }));
  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockCreateChangeMutateAsync.mockClear();
});

describe('ShiftDetailScreen — cancel action confirm', () => {
  it('does not fire the cancel change request until confirmed', () => {
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-cancel'));

    expect(queryByTestId('shift-detail-cancel-confirm')).toBeTruthy();
    expect(mockCreateChangeMutateAsync).not.toHaveBeenCalled();
  });

  it('fires the cancel change request with kind: cancel on confirm', async () => {
    const { getByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-cancel'));
    fireEvent.press(getByTestId('shift-detail-cancel-confirm'));

    await waitFor(() =>
      expect(mockCreateChangeMutateAsync).toHaveBeenCalledWith({
        shiftId: SHIFT_ID,
        input: { kind: 'cancel' },
      })
    );
  });

  it('dismisses without firing on cancel', () => {
    const { getByTestId } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-cancel'));
    fireEvent.press(getByTestId('shift-detail-cancel-dismiss'));

    expect(mockCreateChangeMutateAsync).not.toHaveBeenCalled();
  });
});
