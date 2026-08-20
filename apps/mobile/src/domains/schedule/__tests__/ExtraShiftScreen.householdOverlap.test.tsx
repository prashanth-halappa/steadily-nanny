/**
 * @module domains/schedule/__tests__/ExtraShiftScreen.householdOverlap.test
 *
 * Same-carer overlap is a hard block; other-carer overlap confirms first.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
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
const OTHER_CARER_ID = '66666666-6666-4666-8666-666666666666';

let ExtraShiftScreen: typeof import('../components/ExtraShiftScreen').ExtraShiftScreen;
let mockCreateMutateAsync: ReturnType<typeof mock>;
let mockGetBusyBlocks: ReturnType<typeof mock>;
let mockShiftRange: ReturnType<typeof mock>;
let mockShowErrorToast: ReturnType<typeof mock>;
let mockRouterBack: ReturnType<typeof mock>;

function makeExistingShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'existing-shift',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    starts_at: '2026-08-10T09:00:00.000Z',
    ends_at: '2026-08-10T17:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-08-10',
    kind: 'recurring',
    status: SHIFT_STATUSES.CONFIRMED,
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'existing@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

beforeAll(async () => {
  mockRouterBack = mock();
  mockShowErrorToast = mock();
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
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({
      data: [
        {
          user_id: CARER_ID,
          display_name_override: 'Maria',
          profile_name: null,
          role: 'nanny',
        },
        {
          user_id: OTHER_CARER_ID,
          display_name_override: 'Alex',
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
    showErrorToast: mockShowErrorToast,
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ExtraShiftScreen');
  ExtraShiftScreen = mod.ExtraShiftScreen;
});

beforeEach(() => {
  mockCreateMutateAsync.mockClear();
  mockGetBusyBlocks.mockClear();
  mockShiftRange.mockClear();
  mockShowErrorToast.mockClear();
  mockRouterBack.mockClear();
  mockGetBusyBlocks.mockImplementation(() => Promise.resolve([]));
  mockShiftRange.mockImplementation(() => Promise.resolve([]));
});

describe('ExtraShiftScreen — household overlap pre-check', () => {
  it('shows a confirm dialog when another carer is already booked', async () => {
    mockShiftRange.mockImplementation(() =>
      Promise.resolve([
        makeExistingShift({
          id: 'other-carer-shift',
          carer_id: OTHER_CARER_ID,
        }),
      ])
    );

    const { getByTestId, queryByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() =>
      expect(queryByTestId('schedule-extra-clash-confirm')).toBeTruthy()
    );
    expect(mockCreateMutateAsync).not.toHaveBeenCalled();
  });

  it('blocks same-carer overlap with a toast and never opens the dialog', async () => {
    mockShiftRange.mockImplementation(() =>
      Promise.resolve([makeExistingShift({ id: 'same-carer-shift' })])
    );

    const { getByTestId, queryByTestId } = render(<ExtraShiftScreen />);

    fireEvent.press(getByTestId('schedule-extra-submit'));

    await waitFor(() => expect(mockShowErrorToast).toHaveBeenCalledTimes(1));
    expect(queryByTestId('schedule-extra-clash-confirm')).toBeNull();
    expect(mockCreateMutateAsync).not.toHaveBeenCalled();
  });
});
