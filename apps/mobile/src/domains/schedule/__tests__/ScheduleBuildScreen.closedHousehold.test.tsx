/**
 * @module domains/schedule/__tests__/ScheduleBuildScreen.closedHousehold.test
 *
 * The only server write on this screen is the review step's "Send" CTA
 * (`sendScheduleWeek` chains create -> replaceDays -> send internally — the
 * earlier wizard steps just advance local state). When the household has
 * closed (the reader's membership is `removed`), that CTA must go disabled
 * with a stated reason instead of either working or silently vanishing.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

// This codebase's i18n mock echoes translation keys rather than resolving
// real copy (see ShiftDetailScreen.*.test.tsx for the same convention) — the
// real EN/ES strings for this key are covered by the i18n parity/voice-guard
// suites, not here.
const CLOSED_REASON = 'householdClosedReason';

let ScheduleBuildScreen: typeof import('../components/ScheduleBuildScreen').ScheduleBuildScreen;
let mockUseCanWriteHousehold: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';
const PATTERN_ID = '99999999-9999-4999-8999-999999999999';

// Stable references — a fresh `[]`/`{}` literal returned per mock call
// would make every `.data` dependency array below "change" on every render
// (feeds `ScheduleBuildScreen`'s day-blocks-default effect, which has no
// other guard) and infinite-loop the test.
const CARERS_DATA = [
  {
    id: 'member-1',
    user_id: CARER_ID,
    role: 'nanny' as const,
    display_name_override: null,
    profile_name: 'Priya',
  },
];
const CHILDREN_DATA: unknown[] = [];
const COMMITMENTS_DATA: unknown[] = [];

// A resumed draft with a carer + days already set lands straight on
// 'review' — the only step whose CTA actually writes anything.
const existingDraftPattern = {
  id: PATTERN_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  status: 'draft',
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU',
  days: [
    {
      weekday: 1,
      start_time: '09:00:00',
      end_time: '17:00:00',
      children: [],
    },
  ],
};

beforeAll(async () => {
  mockUseCanWriteHousehold = mock(() => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock(), replace: mock() }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      householdId: HOUSEHOLD_ID,
      household: { id: HOUSEHOLD_ID },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      status: 'onboarded',
      role: 'parent',
      membershipRole: 'owner',
      householdId: HOUSEHOLD_ID,
    }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: CARERS_DATA, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: CHILDREN_DATA, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: () => ({
      data: existingDraftPattern,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: mock(),
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: () => ({
      data: COMMITMENTS_DATA,
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useAvailabilityForCarer', () => ({
    useAvailabilityForCarer: () => ({ data: undefined, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { week_starts_on: 0, timezone: 'UTC' },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateSchedulePattern', () => ({
    useCreateSchedulePattern: () => ({
      mutateAsync: mock(() => Promise.resolve(existingDraftPattern)),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useReplaceSchedulePatternDays', () => ({
    useReplaceSchedulePatternDays: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useSendSchedulePattern', () => ({
    useSendSchedulePattern: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: mockUseCanWriteHousehold,
  }));
  mock.module('@/src/lib/toast', () => ({
    showErrorToast: mock(),
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ScheduleBuildScreen');
  ScheduleBuildScreen = mod.ScheduleBuildScreen;
});

beforeEach(() => {
  mockUseCanWriteHousehold.mockReset();
  mockUseCanWriteHousehold.mockReturnValue({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  });
});

describe('ScheduleBuildScreen closed household', () => {
  it('reaches the review step with the Send CTA enabled while the household is open', () => {
    const { getByTestId, queryByTestId } = render(
      <ScheduleBuildScreen patternId={PATTERN_ID} />
    );

    expect(getByTestId('schedule-send-cta').props.disabled).toBe(false);
    expect(queryByTestId('schedule-send-cta-hint')).toBeNull();
  });

  it('disables the Send CTA with the shared reason once the household has closed', () => {
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    const { getByTestId } = render(
      <ScheduleBuildScreen patternId={PATTERN_ID} />
    );

    // Never hidden — the CTA and the wizard around it still render.
    expect(getByTestId('schedule-send-cta').props.disabled).toBe(true);
    expect(getByTestId('schedule-send-cta-hint').props.children).toBe(
      CLOSED_REASON
    );
  });

  it('disables Send while canWrite is still resolving, without announcing a closure', () => {
    mockUseCanWriteHousehold.mockReturnValue({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });

    const { getByTestId, queryByTestId } = render(
      <ScheduleBuildScreen patternId={PATTERN_ID} />
    );

    expect(getByTestId('schedule-send-cta').props.disabled).toBe(true);
    expect(queryByTestId('schedule-send-cta-hint')).toBeNull();
  });
});
