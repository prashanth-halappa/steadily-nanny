/**
 * @module domains/schedule/__tests__/ExtraShiftScreen.clash.test
 *
 * Pre-submit busy-block clash warning before creating a one-off extra shift.
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
let mockShiftRange: ReturnType<typeof mock>;
let mockRouterBack: ReturnType<typeof mock>;

const CONFLICT_BLOCK = {
  starts_at: '2026-08-10T14:00:00.000Z',
  ends_at: '2026-08-10T18:00:00.000Z',
  kind: 'other_commitment' as const,
};

beforeAll(async () => {
  // D73 added a past-start guard, and this suite's fixture date is fixed. Pin
  // the clock ahead of it so 2026-08-10 stays in the future forever — without
  // this the suite silently starts exercising the past-shift dialog instead of
  // the busy-block one it is about.
  setSystemTime(new Date('2026-08-09T08:00:00.000Z'));
  mockRouterBack = mock();
  mockCreateMutateAsync = mock(() =>
    Promise.resolve({ status: 'created', adopted: false, warnings: [] })
  );
  mockGetBusyBlocks = mock(() => Promise.resolve([]));
  mockShiftRange = mock(() => Promise.resolve([]));

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
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
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
    shiftApi: { range: mockShiftRange },
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
  mockShiftRange.mockClear();
  mockShiftRange.mockImplementation(() => Promise.resolve([]));
});

afterAll(() => {
  setSystemTime();
});

describe('ExtraShiftScreen — busy clash pre-check', () => {
  it('creates directly when there are no conflicting busy blocks', async () => {
    const { getByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockGetBusyBlocks).toHaveBeenCalledTimes(1);
  });

  it('shows a confirm dialog and does not create until confirmed', async () => {
    mockGetBusyBlocks.mockImplementation(() =>
      Promise.resolve([CONFLICT_BLOCK])
    );

    const { getByTestId, queryByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() =>
      expect(queryByTestId('schedule-extra-clash-confirm')).toBeTruthy()
    );
    expect(mockCreateMutateAsync).not.toHaveBeenCalled();
  });

  it('creates after the parent confirms the clash dialog', async () => {
    mockGetBusyBlocks.mockImplementation(() =>
      Promise.resolve([CONFLICT_BLOCK])
    );

    const { getByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() =>
      expect(getByTestId('schedule-extra-clash-confirm')).toBeTruthy()
    );
    fireEvent.press(getByTestId('schedule-extra-clash-confirm'));

    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it('creates directly when the busy lookup fails', async () => {
    mockGetBusyBlocks.mockImplementation(() =>
      Promise.reject(new Error('network'))
    );

    const { getByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1));
  });
});
