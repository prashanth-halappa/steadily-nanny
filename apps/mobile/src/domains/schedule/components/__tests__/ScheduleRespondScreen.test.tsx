import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

const PATTERN_ID = 'pattern-1';
const ME = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

let mockBack: ReturnType<typeof mock>;

let ScheduleRespondScreen: typeof import('../ScheduleRespondScreen').ScheduleRespondScreen;

beforeAll(async () => {
  mockBack = mock();

  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: () => ({
      data: {
        id: PATTERN_ID,
        household_id: HOUSEHOLD_ID,
        days: [],
      },
      isLoading: false,
      isError: false,
    }),
  }));

  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({ data: { week_starts_on: 1 } }),
  }));

  mock.module('@/src/hooks/queries/useAvailability', () => ({
    useAvailability: () => ({ data: [], isLoading: false }),
  }));

  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [] }),
  }));

  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: () => ({ data: [] }),
  }));

  mock.module('@/src/hooks/mutations/useRespondToSchedulePattern', () => ({
    useRespondToSchedulePattern: () => ({
      mutateAsync: mock(),
      isPending: false,
    }),
  }));

  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mockBack, replace: mock() }),
  }));

  const mod = await import('../ScheduleRespondScreen');
  ScheduleRespondScreen = mod.ScheduleRespondScreen;
});

describe('ScheduleRespondScreen', () => {
  it('renders a back button that navigates back', () => {
    const { getByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );

    const backButton = getByTestId('schedule-respond-back');
    expect(backButton).toBeTruthy();

    fireEvent.press(backButton);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
