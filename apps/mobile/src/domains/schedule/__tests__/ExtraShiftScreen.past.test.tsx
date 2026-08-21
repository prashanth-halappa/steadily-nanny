/**
 * @module domains/schedule/__tests__/ExtraShiftScreen.past.test
 *
 * Past-start one-off shift requires confirm before create.
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

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';

let ExtraShiftScreen: typeof import('../components/ExtraShiftScreen').ExtraShiftScreen;
let mockCreateMutateAsync: ReturnType<typeof mock>;
let mockGetBusyBlocks: ReturnType<typeof mock>;
let mockShiftRange: ReturnType<typeof mock>;
let mockRouterBack: ReturnType<typeof mock>;

beforeAll(async () => {
  mockRouterBack = mock();
  mockCreateMutateAsync = mock(() =>
    Promise.resolve({ status: 'created', adopted: false, warnings: [] })
  );
  mockGetBusyBlocks = mock(() => Promise.resolve([]));
  mockShiftRange = mock(() => Promise.resolve([]));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mockRouterBack, push: mock() }),
    useLocalSearchParams: () => ({
      date: '2020-01-01',
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
  mock.module('@/src/lib/toast', () => ({
    showErrorToast: mock(),
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ExtraShiftScreen');
  ExtraShiftScreen = mod.ExtraShiftScreen;
});

beforeEach(() => {
  mockCreateMutateAsync.mockClear();
  mockGetBusyBlocks.mockClear();
  mockShiftRange.mockClear();
  mockRouterBack.mockClear();
  mockGetBusyBlocks.mockImplementation(() => Promise.resolve([]));
  mockShiftRange.mockImplementation(() => Promise.resolve([]));
});

describe('ExtraShiftScreen — past start pre-check', () => {
  it('shows a confirm dialog and does not create until confirmed', async () => {
    const { getByTestId, queryByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() =>
      expect(queryByTestId('schedule-extra-clash-confirm')).toBeTruthy()
    );
    expect(mockCreateMutateAsync).not.toHaveBeenCalled();
  });

  it('creates after the parent confirms the past-start dialog', async () => {
    const { getByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() =>
      expect(getByTestId('schedule-extra-clash-confirm')).toBeTruthy()
    );
    fireEvent.press(getByTestId('schedule-extra-clash-confirm'));

    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
