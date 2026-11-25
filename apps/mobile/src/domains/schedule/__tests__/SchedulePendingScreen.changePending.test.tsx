/**
 * @module domains/schedule/__tests__/SchedulePendingScreen.changePending.test
 *
 * UX spec §2b: a pending usual week can't be edited in place server-side,
 * so "Change it" is withdraw-then-rebuild — confirm, withdraw, and only on a
 * successful withdraw push the build wizard prefilled from the withdrawn
 * pattern (`?fromPatternId=`).
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

let SchedulePendingScreen: typeof import('../components/SchedulePendingScreen').SchedulePendingScreen;
let mockUseCanWriteHousehold: ReturnType<typeof mock>;
let mockUseSchedulePatterns: ReturnType<typeof mock>;
let mockWithdrawMutateAsync: ReturnType<typeof mock>;
let mockAmendMutateAsync: ReturnType<typeof mock>;
const mockPush = mock();
let mockRole = 'parent';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PATTERN_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const ME_ID = '44444444-4444-4444-8444-444444444444';

function makePattern(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PATTERN_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    status: 'pending',
    rrule: 'FREQ=WEEKLY',
    dtstart: '2026-08-03',
    until: null,
    exdates: [],
    pause_ranges: [],
    sent_at: '2026-08-01T00:00:00.000Z',
    decline_message: null,
    created_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  mockUseCanWriteHousehold = mock(() => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }));
  mockUseSchedulePatterns = mock(() => ({
    data: [makePattern()],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockWithdrawMutateAsync = mock(() =>
    Promise.resolve(makePattern({ status: 'withdrawn' }))
  );
  mockAmendMutateAsync = mock(() =>
    Promise.resolve({ schedule_pattern: makePattern(), warnings: [] })
  );

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mockPush }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      status: 'onboarded',
      role: mockRole,
      membershipRole: 'owner',
      householdId: HOUSEHOLD_ID,
      householdState: 'active',
      isPastMember: false,
      membershipsError: false,
      retryMemberships: mock(),
    }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: mockUseCanWriteHousehold,
  }));
  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: mockUseSchedulePatterns,
  }));
  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: () => ({
      data: { days: [] },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: [], isLoading: false }),
  }));
  // D72: the screen merges in carers who have NO pattern, so it now reads the
  // carer list too — unmocked, that is a React Query hook with no provider.
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawSchedulePattern', () => ({
    useWithdrawSchedulePattern: () => ({
      mutateAsync: mockWithdrawMutateAsync,
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useAmendSchedulePattern', () => ({
    useAmendSchedulePattern: () => ({
      mutateAsync: mockAmendMutateAsync,
      isPending: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ user: { id: ME_ID } }),
  }));
  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/SchedulePendingScreen');
  SchedulePendingScreen = mod.SchedulePendingScreen;
});

beforeEach(() => {
  mockUseCanWriteHousehold.mockReturnValue({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  });
  mockUseSchedulePatterns.mockReturnValue({
    data: [makePattern()],
    isLoading: false,
    isError: false,
    refetch: mock(),
  });
  mockRole = 'parent';
  mockPush.mockClear();
  mockWithdrawMutateAsync.mockReset();
  mockWithdrawMutateAsync.mockImplementation(() =>
    Promise.resolve(makePattern({ status: 'withdrawn' }))
  );
  mockAmendMutateAsync.mockClear();
});

describe('SchedulePendingScreen — Change it (pending)', () => {
  it('offers Change it next to Withdraw on a pending week', () => {
    const { getByTestId, queryByTestId } = render(<SchedulePendingScreen />);
    expect(getByTestId('schedule-pending-withdraw')).toBeTruthy();
    expect(getByTestId('schedule-pending-change')).toBeTruthy();
    // Dialog stays closed until pressed.
    expect(queryByTestId('schedule-pending-change-confirm')).toBeNull();
  });

  it('is hidden when the pattern is not pending', () => {
    mockUseSchedulePatterns.mockReturnValue({
      data: [makePattern({ status: 'accepted' })],
      isLoading: false,
      isError: false,
      refetch: mock(),
    });
    const { queryByTestId } = render(<SchedulePendingScreen />);
    expect(queryByTestId('schedule-pending-change')).toBeNull();
  });

  it('is hidden when the viewer cannot edit the schedule (helper)', () => {
    mockRole = 'helper';
    const { queryByTestId } = render(<SchedulePendingScreen />);
    expect(queryByTestId('schedule-pending-change')).toBeNull();
    expect(queryByTestId('schedule-pending-withdraw')).toBeNull();
  });

  it('confirm withdraws, then pushes the build wizard prefilled from the withdrawn pattern', async () => {
    const { getByTestId } = render(<SchedulePendingScreen />);
    fireEvent.press(getByTestId('schedule-pending-change'));
    fireEvent.press(getByTestId('schedule-pending-change-confirm'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockWithdrawMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/schedule/build?fromPatternId=${PATTERN_ID}&carerId=${CARER_ID}`
    );
  });

  it('a failed withdraw never navigates', async () => {
    mockWithdrawMutateAsync.mockImplementation(() =>
      Promise.reject(new Error('boom'))
    );
    const { getByTestId } = render(<SchedulePendingScreen />);
    fireEvent.press(getByTestId('schedule-pending-change'));
    fireEvent.press(getByTestId('schedule-pending-change-confirm'));

    await waitFor(() =>
      expect(mockWithdrawMutateAsync).toHaveBeenCalledTimes(1)
    );
    await Promise.resolve();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
