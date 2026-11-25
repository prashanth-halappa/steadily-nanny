/**
 * @module domains/schedule/__tests__/ScheduleBuildScreen.fromPattern.test
 *
 * UX spec §2b: "Change it" on a pending usual week withdraws it, then opens
 * this wizard with `fromPatternId`. The days come from that (now withdrawn)
 * pattern, but its id is never reused — Send creates a NEW pattern. If the
 * fetch fails there is nothing to resume, so it falls through to the normal
 * care-hours prefill instead of the draft-error step.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let ScheduleBuildScreen: typeof import('../components/ScheduleBuildScreen').ScheduleBuildScreen;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';
const OLD_PATTERN_ID = '99999999-9999-4999-8999-999999999999';
const NEW_PATTERN_ID = '88888888-8888-4888-8888-888888888888';
const CHILD_ID = '66666666-6666-4666-8666-666666666666';

// Stable references (see ScheduleBuildScreen.closedHousehold.test.tsx).
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
// Care hours on Monday — distinct from the withdrawn pattern's Wednesday.
const COMMITMENTS_DATA = [
  {
    child_id: CHILD_ID,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    start_time: '07:00:00',
    end_time: '13:00:00',
  },
];

const withdrawnPattern = {
  id: OLD_PATTERN_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  status: 'withdrawn',
  rrule: 'FREQ=WEEKLY;BYDAY=WE',
  days: [
    {
      weekday: 3,
      start_time: '10:00:00',
      end_time: '14:00:00',
      children: [],
    },
  ],
};

const okQuery = {
  data: withdrawnPattern,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: mock(),
};
const errorQuery = {
  data: undefined,
  isLoading: false,
  isError: true,
  isFetching: false,
  refetch: mock(),
};

let patternQuery: typeof okQuery | typeof errorQuery = okQuery;
const mockUseSchedulePattern = mock(
  (_id: string | null | undefined) => patternQuery
);
const mockCreate = mock((_input: unknown) =>
  Promise.resolve({ id: NEW_PATTERN_ID, status: 'draft' })
);
const mockReplaceDays = mock((_args: unknown) => Promise.resolve({}));
const mockSend = mock((_args: unknown) => Promise.resolve({}));

beforeAll(async () => {
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
    useSchedulePattern: mockUseSchedulePattern,
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
      mutateAsync: mockCreate,
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useReplaceSchedulePatternDays', () => ({
    useReplaceSchedulePatternDays: () => ({
      mutateAsync: mockReplaceDays,
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useSendSchedulePattern', () => ({
    useSendSchedulePattern: () => ({ mutateAsync: mockSend, isPending: false }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
  mock.module('@/src/lib/toast', () => ({
    showErrorToast: mock(),
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ScheduleBuildScreen');
  ScheduleBuildScreen = mod.ScheduleBuildScreen;
});

beforeEach(() => {
  patternQuery = okQuery;
  mockUseSchedulePattern.mockClear();
  mockCreate.mockClear();
  mockReplaceDays.mockClear();
  mockSend.mockClear();
});

describe('ScheduleBuildScreen — fromPatternId (change a pending week)', () => {
  it('prefills the days from that pattern and Send creates a NEW pattern', async () => {
    const { getByTestId, queryByTestId } = render(
      <ScheduleBuildScreen fromPatternId={OLD_PATTERN_ID} carerId={CARER_ID} />
    );

    expect(mockUseSchedulePattern).toHaveBeenCalledWith(OLD_PATTERN_ID);
    // Hydrated from the pattern, not the care hours.
    expect(queryByTestId('schedule-review-prefill-note')).toBeNull();
    fireEvent.press(getByTestId('schedule-send-cta'));

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockReplaceDays).toHaveBeenCalledWith({
      patternId: NEW_PATTERN_ID,
      days: [
        { weekday: 3, start_time: '10:00', end_time: '14:00', children: [] },
      ],
    });
    expect(mockSend).toHaveBeenCalledWith({ patternId: NEW_PATTERN_ID });
    for (const call of [
      ...mockReplaceDays.mock.calls,
      ...mockSend.mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toContain(OLD_PATTERN_ID);
    }
  });

  it('a failed fetch falls through to the care-hours prefill, never draft-error', async () => {
    patternQuery = errorQuery;
    const { getByTestId, queryByTestId } = render(
      <ScheduleBuildScreen fromPatternId={OLD_PATTERN_ID} carerId={CARER_ID} />
    );

    expect(queryByTestId('schedule-build-draft-error')).toBeNull();
    expect(getByTestId('schedule-review-prefill-note')).toBeTruthy();
    fireEvent.press(getByTestId('schedule-send-cta'));

    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockReplaceDays).toHaveBeenCalledWith({
      patternId: NEW_PATTERN_ID,
      days: [
        {
          weekday: 1,
          start_time: '07:00',
          end_time: '13:00',
          children: [{ child_id: CHILD_ID }],
        },
      ],
    });
  });
});
