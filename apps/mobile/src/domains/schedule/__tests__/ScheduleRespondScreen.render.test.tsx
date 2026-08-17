/**
 * @module domains/schedule/__tests__/ScheduleRespondScreen.render.test
 *
 * Render tests for the three trust defects the sibling source-inspection
 * file can only assert structurally:
 *
 *  1. Accept lands on the PATTERN's own household calendar (query-string
 *     `householdId`), not whatever the switcher happens to have active.
 *  2. Pattern C2 — a FAILED pattern read renders a retryable ErrorState
 *     instead of holding a spinner forever.
 *  3. Pattern B — an UNKNOWN availability read flags no days at all (the
 *     `?? []` fallback made `isOutsideAvailability` true for every day) and
 *     offers an inline retry, while a genuinely EMPTY successful read keeps
 *     flagging, exactly as before.
 *
 * Every hook is mocked via `mock.module()` in `beforeAll`, BEFORE the dynamic
 * import of the component (docs/09-TESTING.md). `useReducedMotion` /
 * `useColorScheme` are mocked for the same reason AdjustSchedulePatternSheet's
 * test mocks them — BottomSheetBase mounts through them.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

// LoadingIndicator's require('@/assets/splash.png') breaks bundling under
// bun:test — same stand-in ScheduleShiftsScreen.test.tsx uses.
mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

mock.module('@/src/components/custom/ErrorState', () => {
  const React = require('react');
  return {
    ErrorState: (props: { variant?: string; onRetry?: () => void }) =>
      React.createElement('View', {
        testID: 'error-state',
        accessibilityLabel: props.variant ?? 'generic',
        children: props.onRetry
          ? React.createElement('View', {
              testID: 'error-state-retry',
              onPress: props.onRetry,
            })
          : null,
      }),
  };
});

const mockReplace = mock();
const mockBack = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mockBack, replace: mockReplace }),
  useLocalSearchParams: () => ({}),
  router: { push: mock(), replace: mockReplace, back: mockBack },
}));

mock.module('@/src/lib/toast', () => ({
  showSuccessToast: mock(),
  showErrorToast: mock(),
  showInfoToast: mock(),
  showWarningToast: mock(),
  useToast: () => ({ show: mock() }),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PATTERN_ID = '22222222-2222-4222-8222-222222222222';
const DAY_ID = '33333333-3333-4333-8333-333333333333';

// Monday 09:00-17:00, one child, no per-child window.
function makePattern() {
  return {
    id: PATTERN_ID,
    household_id: HOUSEHOLD_ID,
    status: 'pending',
    days: [
      {
        id: DAY_ID,
        weekday: 1,
        start_time: '09:00:00',
        end_time: '17:00:00',
        children: [],
      },
    ],
  };
}

let patternState: any;
let availabilityState: any;
const patternRefetch = mock(() => Promise.resolve());
const availabilityRefetch = mock(() => Promise.resolve());
const mutateAsync = mock(() => Promise.resolve());

let ScheduleRespondScreen: typeof import('../components/ScheduleRespondScreen').ScheduleRespondScreen;

beforeAll(async () => {
  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: () => patternState,
  }));
  mock.module('@/src/hooks/queries/useAvailability', () => ({
    useAvailability: () => availabilityState,
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({ data: { week_starts_on: 1 }, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useRespondToSchedulePattern', () => ({
    useRespondToSchedulePattern: () => ({ mutateAsync, isPending: false }),
  }));

  ({ ScheduleRespondScreen } = await import(
    '../components/ScheduleRespondScreen'
  ));
});

beforeEach(() => {
  mockReplace.mockClear();
  mockBack.mockClear();
  patternRefetch.mockClear();
  availabilityRefetch.mockClear();
  mutateAsync.mockClear();
  patternState = {
    data: makePattern(),
    isLoading: false,
    isError: false,
    refetch: patternRefetch,
  };
  availabilityState = {
    data: [],
    isLoading: false,
    isError: false,
    refetch: availabilityRefetch,
  };
});

describe('ScheduleRespondScreen — accept destination', () => {
  it("replaces to the PATTERN's own household calendar, not the switcher's", async () => {
    const { getByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );
    fireEvent.press(getByTestId('schedule-respond-accept'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const href = String(mockReplace.mock.calls[0]?.[0] ?? '');
    expect(href).toContain('/(private)/schedule/shifts');
    expect(href).toContain(`householdId=${HOUSEHOLD_ID}`);
  });
});

describe('ScheduleRespondScreen — Pattern C2, failed pattern read', () => {
  it('renders a retryable ErrorState instead of a forever spinner', () => {
    patternState = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: patternRefetch,
    };
    const { getByTestId, queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );

    expect(getByTestId('schedule-respond-error')).toBeTruthy();
    expect(getByTestId('error-state').props.accessibilityLabel).toBe('network');
    expect(queryByTestId('loading-indicator-container')).toBeNull();

    fireEvent.press(getByTestId('error-state-retry'));
    expect(patternRefetch).toHaveBeenCalledTimes(1);
  });

  it('still shows the spinner while the pattern is genuinely loading', () => {
    patternState = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: patternRefetch,
    };
    const { getByTestId, queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );
    expect(getByTestId('loading-indicator-container')).toBeTruthy();
    expect(queryByTestId('schedule-respond-error')).toBeNull();
  });
});

describe('ScheduleRespondScreen — Pattern B, unknown availability', () => {
  it('flags NO day and offers an inline retry when availability failed', () => {
    availabilityState = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: availabilityRefetch,
    };
    const { getByTestId, queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );

    expect(
      queryByTestId(`schedule-respond-outside-hours-${DAY_ID}`)
    ).toBeNull();
    expect(getByTestId('schedule-respond-availability-retry')).toBeTruthy();

    fireEvent.press(getByTestId('schedule-respond-availability-retry-button'));
    expect(availabilityRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows neither flags nor the retry line while availability is loading', () => {
    availabilityState = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: availabilityRefetch,
    };
    const { queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );
    expect(
      queryByTestId(`schedule-respond-outside-hours-${DAY_ID}`)
    ).toBeNull();
    expect(queryByTestId('schedule-respond-availability-retry')).toBeNull();
  });

  it('UNCHANGED: an empty SUCCESSFUL availability list still flags the day', () => {
    const { getByTestId, queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );
    expect(
      getByTestId(`schedule-respond-outside-hours-${DAY_ID}`)
    ).toBeTruthy();
    expect(queryByTestId('schedule-respond-availability-retry')).toBeNull();
  });

  it('does not flag a day that sits inside marked availability', () => {
    availabilityState = {
      data: [
        {
          weekday: 1,
          is_available: true,
          earliest_start: '08:00:00',
          latest_finish: '18:00:00',
        },
      ],
      isLoading: false,
      isError: false,
      refetch: availabilityRefetch,
    };
    const { queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );
    expect(
      queryByTestId(`schedule-respond-outside-hours-${DAY_ID}`)
    ).toBeNull();
  });
});
