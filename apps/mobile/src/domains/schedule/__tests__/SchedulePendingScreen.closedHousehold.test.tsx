/**
 * @module domains/schedule/__tests__/SchedulePendingScreen.closedHousehold.test
 *
 * When the employing parent deletes their account, the remaining member's
 * `household_members` row flips to `removed` and every write the server
 * accepts from her 403s. `SchedulePendingScreen` gated amend/withdraw (and
 * every navigate-into-edit CTA) on role alone — this covers the household-
 * closed gate added on top: disabled with a reason, never hidden.
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

let SchedulePendingScreen: typeof import('../components/SchedulePendingScreen').SchedulePendingScreen;
let mockUseCanWriteHousehold: ReturnType<typeof mock>;
let mockUseSchedulePatterns: ReturnType<typeof mock>;
let mockWithdrawMutateAsync: ReturnType<typeof mock>;
let mockAmendMutateAsync: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PATTERN_ID = '22222222-2222-4222-8222-222222222222';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const ME_ID = '44444444-4444-4444-8444-444444444444';
// This test harness's i18n stub echoes back whatever key `t()`/`tCommon()`
// is called with rather than resolving real copy (see sibling suites, e.g.
// `pending.withdraw` renders as the literal string "pending.withdraw") — so
// the assertion below is against the ECHOED KEY, not the production English
// sentence. `docs/09-TESTING.md`/`i18n-tests-cannot-catch-hardcoded-keys`.
const CLOSED_REASON = 'householdClosedReason';

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
    useRouter: () => ({ back: mock(), push: mock() }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      status: 'onboarded',
      role: 'parent',
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
  mockWithdrawMutateAsync.mockClear();
  mockAmendMutateAsync.mockClear();
});

describe('SchedulePendingScreen — closed household gate', () => {
  it('shows the withdraw trigger disabled with the shared reason when the household has closed', () => {
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    const { getByTestId } = render(<SchedulePendingScreen />);

    const trigger = getByTestId('schedule-pending-withdraw');
    expect(trigger.props.disabled).toBe(true);
    expect(getByTestId('schedule-pending-withdraw-reason').props.children).toBe(
      CLOSED_REASON
    );
  });

  it('withdraw stays enabled, no reason shown, when the household is open', () => {
    const { getByTestId, queryByTestId } = render(<SchedulePendingScreen />);

    const trigger = getByTestId('schedule-pending-withdraw');
    expect(trigger.props.disabled).toBeFalsy();
    expect(queryByTestId('schedule-pending-withdraw-reason')).toBeNull();
  });

  it('never hides the withdraw trigger when closed — it stays rendered, just disabled', () => {
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    const { getByTestId } = render(<SchedulePendingScreen />);

    expect(getByTestId('schedule-pending-withdraw')).toBeTruthy();
  });

  it('never calls withdraw on mount alone when the household is closed', () => {
    // The mocked `@rn-primitives/alert-dialog` Trigger here is uncontrolled
    // and has no built-in press-to-open wiring, so the confirm action inside
    // the dialog is unreachable in this harness — the disabled-trigger
    // assertions above are the reachable, meaningful contract. This just
    // guards against any regression that fires the mutation eagerly.
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    render(<SchedulePendingScreen />);

    expect(mockWithdrawMutateAsync).not.toHaveBeenCalled();
  });

  it('gates the empty-state "Build your week" CTA disabled with the shared reason when closed and there are no patterns', () => {
    mockUseSchedulePatterns.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mock(),
    });
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    const { getByTestId } = render(<SchedulePendingScreen />);

    const cta = getByTestId('schedule-pending-build-cta');
    expect(cta.props.disabled).toBe(true);
    expect(
      getByTestId('schedule-pending-build-cta-reason').props.children
    ).toBe(CLOSED_REASON);
  });

  it('the empty-state "Build your week" CTA stays enabled when the household is open', () => {
    mockUseSchedulePatterns.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mock(),
    });

    const { getByTestId, queryByTestId } = render(<SchedulePendingScreen />);

    expect(
      getByTestId('schedule-pending-build-cta').props.disabled
    ).toBeFalsy();
    expect(queryByTestId('schedule-pending-build-cta-reason')).toBeNull();
  });

  it('while useCanWriteHousehold is still loading, the withdraw trigger is disabled but shows no reason yet', () => {
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });

    const { getByTestId, queryByTestId } = render(<SchedulePendingScreen />);

    expect(getByTestId('schedule-pending-withdraw').props.disabled).toBe(true);
    expect(queryByTestId('schedule-pending-withdraw-reason')).toBeNull();
  });
});
