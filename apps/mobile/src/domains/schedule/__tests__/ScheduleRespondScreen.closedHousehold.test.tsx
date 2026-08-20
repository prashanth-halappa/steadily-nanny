/**
 * @module domains/schedule/__tests__/ScheduleRespondScreen.closedHousehold.test
 *
 * When the employing parent's account is deleted, every remaining member's
 * `household_members` row flips to `removed` and writes genuinely 403/404 on
 * the server. Accept/Decline must go DISABLED WITH A REASON, never hidden
 * (S4, `useRestrictedAction`'s module doc) — a missing button here reads as
 * "the app is broken", not "this family is gone".
 *
 * `useCanWriteHousehold` is keyed off the PATTERN's own household id, not
 * the switcher's active one — same rule the file's Wave B doc comment
 * already states for `useChildren`/`useHouseholdCommitments`.
 *
 * Mocking shape copied from `ScheduleRespondScreen.render.test.tsx`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

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
      }),
  };
});

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
  useLocalSearchParams: () => ({}),
  router: { push: mock(), replace: mock(), back: mock() },
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

function makePattern() {
  return {
    id: PATTERN_ID,
    household_id: HOUSEHOLD_ID,
    status: 'pending',
    days: [],
  };
}

// bun.setup.ts mocks react-i18next as a KEY-ECHO: t(key) returns key itself,
// so tests assert on the stable key, not the translated copy.
const REASON = 'householdClosedReason';

let canWriteState: {
  canWrite: boolean;
  isPastMember: boolean;
  isLoading: boolean;
};
const useCanWriteHouseholdMock = mock(
  (_householdId: string | null | undefined) => canWriteState
);
const mutateAsync = mock(() => Promise.resolve());

let ScheduleRespondScreen: typeof import('../components/ScheduleRespondScreen').ScheduleRespondScreen;

beforeAll(async () => {
  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: () => ({
      data: makePattern(),
      isLoading: false,
      isError: false,
      refetch: mock(),
    }),
  }));
  mock.module('@/src/hooks/queries/useAvailability', () => ({
    useAvailability: () => ({ data: [], isLoading: false, isError: false }),
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
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: useCanWriteHouseholdMock,
  }));

  ({ ScheduleRespondScreen } = await import(
    '../components/ScheduleRespondScreen'
  ));
});

beforeEach(() => {
  mutateAsync.mockClear();
  useCanWriteHouseholdMock.mockClear();
  canWriteState = { canWrite: true, isPastMember: false, isLoading: false };
});

describe('ScheduleRespondScreen — closed household', () => {
  it('disables Accept and Decline with the shared reason when the household is closed', () => {
    canWriteState = { canWrite: false, isPastMember: true, isLoading: false };
    const { getByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );

    // Never hidden.
    expect(getByTestId('schedule-respond-accept')).toBeTruthy();
    expect(getByTestId('schedule-respond-decline')).toBeTruthy();

    expect(getByTestId('schedule-respond-accept').props.disabled).toBe(true);
    expect(getByTestId('schedule-respond-accept-reason').props.children).toBe(
      REASON
    );
    expect(getByTestId('schedule-respond-decline').props.disabled).toBe(true);
    expect(getByTestId('schedule-respond-decline-reason').props.children).toBe(
      REASON
    );

    // Resolves against the PATTERN's own household id, not a guess.
    expect(useCanWriteHouseholdMock).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('leaves Accept and Decline enabled, with no reason, when the household is open', () => {
    const { getByTestId, queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );

    expect(getByTestId('schedule-respond-accept').props.disabled).toBe(false);
    expect(getByTestId('schedule-respond-decline').props.disabled).toBe(false);
    expect(queryByTestId('schedule-respond-accept-reason')).toBeNull();
    expect(queryByTestId('schedule-respond-decline-reason')).toBeNull();

    fireEvent.press(getByTestId('schedule-respond-accept'));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('disables both, with NO reason yet, while the membership read is still unresolved', () => {
    canWriteState = { canWrite: false, isPastMember: false, isLoading: true };
    const { getByTestId, queryByTestId } = render(
      <ScheduleRespondScreen patternId={PATTERN_ID} />
    );

    expect(getByTestId('schedule-respond-accept').props.disabled).toBe(true);
    expect(getByTestId('schedule-respond-decline').props.disabled).toBe(true);
    // Fails toward WAIT — must not announce a closure it hasn't confirmed.
    expect(queryByTestId('schedule-respond-accept-reason')).toBeNull();
    expect(queryByTestId('schedule-respond-decline-reason')).toBeNull();
  });
});
