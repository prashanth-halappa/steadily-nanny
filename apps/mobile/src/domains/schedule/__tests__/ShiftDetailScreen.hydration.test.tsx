/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.hydration.test
 *
 * R5: expo-router reuses this screen when navigating shift A → shift B.
 * The hydration latch must be per shift id so pickers re-seed on a new
 * shift but do not clobber in-progress edits on a refetch of the same id.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

mock.module('@/src/components/ui/time-range-picker', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    TimeRangePicker: ({
      start,
      end,
      onChange,
      testID,
    }: {
      start: string;
      end: string;
      onChange: (s: string, e: string) => void;
      testID?: string;
    }) =>
      React.createElement(
        View,
        { testID },
        React.createElement(Text, { testID: `${testID}-start-value` }, start),
        React.createElement(Text, { testID: `${testID}-end-value` }, end),
        React.createElement(Pressable, {
          testID: `${testID}-edit-start`,
          onPress: () => onChange('11:30', end),
        })
      ),
    isEndAfterStart: () => true,
  };
});

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

const SHIFT_A_ID = '22222222-2222-4222-8222-222222222222';
const SHIFT_B_ID = '33333333-3333-4333-8333-333333333333';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function makeShift(
  id: string,
  startsAt: string,
  endsAt: string,
  note: string | null = null
) {
  return {
    id,
    household_id: HOUSEHOLD_ID,
    carer_id: '55555555-5555-4555-8555-555555555555',
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: 'America/New_York',
    local_date: '2026-08-03',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note,
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
}

// 09:00–17:00 and 10:00–18:00 in America/New_York on 2026-08-03
const shiftA = makeShift(
  SHIFT_A_ID,
  '2026-08-03T13:00:00.000Z',
  '2026-08-03T21:00:00.000Z'
);
const shiftB = makeShift(
  SHIFT_B_ID,
  '2026-08-03T14:00:00.000Z',
  '2026-08-03T22:00:00.000Z'
);

beforeAll(async () => {
  mockUseShift = mock(() => ({ data: shiftA, isLoading: false }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_A_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: mockUseShift,
  }));
  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: () => ({ data: null, isLoading: false }),
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
  mock.module('@/src/hooks/queries/useHouseholds', () => ({
    useHouseholds: () => ({ data: [], isLoading: false }),
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
      mutateAsync: mock(() => Promise.resolve({})),
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
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: null }),
  }));
  mock.module('@/src/lib/toast', () => ({ showSuccessToast: mock() }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockUseShift.mockImplementation(() => ({ data: shiftA, isLoading: false }));
});

describe('ShiftDetailScreen — per-shift hydration latch', () => {
  it('re-seeds pickers when the shift id changes', () => {
    const { getByTestId, rerender } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-times-start-value').props.children).toBe(
      '09:00'
    );
    expect(getByTestId('shift-detail-times-end-value').props.children).toBe(
      '17:00'
    );

    mockUseShift.mockImplementation(() => ({ data: shiftB, isLoading: false }));
    rerender(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-times-start-value').props.children).toBe(
      '10:00'
    );
    expect(getByTestId('shift-detail-times-end-value').props.children).toBe(
      '18:00'
    );
  });

  it('does not clobber an edited start time when the same shift refetches', () => {
    const { getByTestId, rerender } = render(<ShiftDetailScreen />);

    fireEvent.press(getByTestId('shift-detail-times-edit-start'));
    expect(getByTestId('shift-detail-times-start-value').props.children).toBe(
      '11:30'
    );

    mockUseShift.mockImplementation(() => ({
      data: { ...shiftA, note: 'refetched note' },
      isLoading: false,
    }));
    rerender(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-times-start-value').props.children).toBe(
      '11:30'
    );
  });
});
