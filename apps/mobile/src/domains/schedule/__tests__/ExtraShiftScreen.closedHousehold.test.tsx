/**
 * @module domains/schedule/__tests__/ExtraShiftScreen.closedHousehold
 *
 * The employing parent's household can close (member row flips to
 * `removed`) after this form is already mid-fill. The submit CTA must go
 * disabled-with-a-reason, never hidden, never a silent 403 on submit.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
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

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';

let ExtraShiftScreen: typeof import('../components/ExtraShiftScreen').ExtraShiftScreen;
let mockCreateMutateAsync: ReturnType<typeof mock>;
let mockGetBusyBlocks: ReturnType<typeof mock>;
let mockRouterBack: ReturnType<typeof mock>;
const useCanWriteHouseholdMock = mock(() => ({
  canWrite: true,
  isPastMember: false,
  isLoading: false,
}));

beforeAll(async () => {
  // D73 added a past-start guard and this suite's fixture date is fixed —
  // pin the clock ahead of it so the submit under test stays a plain create
  // rather than the past-shift confirmation.
  setSystemTime(new Date('2026-08-09T08:00:00.000Z'));
  mockRouterBack = mock();
  mockCreateMutateAsync = mock(() =>
    Promise.resolve({ status: 'created', adopted: false, warnings: [] })
  );
  mockGetBusyBlocks = mock(() => Promise.resolve([]));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mockRouterBack, push: mock() }),
    useLocalSearchParams: () => ({
      date: '2026-08-10',
      start: '09:00',
      end: '17:00',
      carerId: CARER_ID,
    }),
    router: { push: mock(), replace: mock(), back: mockRouterBack },
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ status: 'onboarded', role: 'parent' }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      householdId: HOUSEHOLD_ID,
      household: { timezone: 'UTC' },
    }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: useCanWriteHouseholdMock,
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: () => ({ disabled: false, reason: null }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({
      data: [
        {
          user_id: CARER_ID,
          display_name_override: 'Maria',
          profile_name: null,
          role: 'nanny',
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useCreateExtraShift', () => ({
    useCreateExtraShift: () => ({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
    }),
  }));
  mock.module('@/src/api/endpoints/availability', () => ({
    availabilityApi: { getBusyBlocks: mockGetBusyBlocks },
    availabilityEndpoints: {},
  }));
  mock.module('@/src/api/endpoints/shifts', () => ({
    shiftApi: { range: mock(() => Promise.resolve([])) },
    shiftEndpoints: {},
  }));

  const mod = await import('../components/ExtraShiftScreen');
  ExtraShiftScreen = mod.ExtraShiftScreen;
});

beforeEach(() => {
  mockCreateMutateAsync.mockClear();
  mockGetBusyBlocks.mockClear();
  mockRouterBack.mockClear();
  mockGetBusyBlocks.mockImplementation(() => Promise.resolve([]));
  useCanWriteHouseholdMock.mockReset();
  useCanWriteHouseholdMock.mockReturnValue({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  });
});

describe('ExtraShiftScreen — closed household', () => {
  it('stays visible but disabled, with the closed reason, when the household has closed', () => {
    useCanWriteHouseholdMock.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    const { getByTestId } = render(<ExtraShiftScreen />);

    const submit = getByTestId('schedule-extra-submit');
    expect(submit).toBeTruthy();
    expect(submit.props.disabled).toBe(true);
    expect(getByTestId('schedule-extra-submit-reason').props.children).toBe(
      'householdClosedReason'
    );
  });

  it('does not create a shift when pressed while closed', () => {
    useCanWriteHouseholdMock.mockReturnValue({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    const { getByTestId } = render(<ExtraShiftScreen />);
    fireEvent.press(getByTestId('schedule-extra-submit'));

    expect(mockCreateMutateAsync).not.toHaveBeenCalled();
  });

  it('behaves normally — enabled, no reason — when the household is open', async () => {
    const { getByTestId, queryByTestId } = render(<ExtraShiftScreen />);

    const submit = getByTestId('schedule-extra-submit');
    expect(submit.props.disabled).toBe(false);
    expect(queryByTestId('schedule-extra-submit-reason')).toBeNull();

    fireEvent.press(submit);
    // `waitFor`, not a fixed number of microtask ticks: the pre-submit
    // advisory checks (busy blocks + the household's shifts for that day,
    // D73/D74) are awaited together, so counting hops here breaks whenever
    // that lookup changes shape.
    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1));
  });

  it('disables submit (no reason yet) while the membership read is still unresolved', () => {
    useCanWriteHouseholdMock.mockReturnValue({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });

    const { getByTestId, queryByTestId } = render(<ExtraShiftScreen />);

    const submit = getByTestId('schedule-extra-submit');
    expect(submit.props.disabled).toBe(true);
    // Unknown must not announce a closure it hasn't confirmed.
    expect(queryByTestId('schedule-extra-submit-reason')).toBeNull();
  });
});

afterAll(() => {
  setSystemTime();
});
