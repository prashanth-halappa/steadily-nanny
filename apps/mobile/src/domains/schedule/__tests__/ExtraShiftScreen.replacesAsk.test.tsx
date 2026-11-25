/**
 * @module domains/schedule/__tests__/ExtraShiftScreen.replacesAsk.test
 *
 * §2a "Change the ask": with `replacesShiftId`, Send withdraws the old ask
 * FIRST and only then creates the new one. Failure mode is "no ask", never
 * "two asks".
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';
const OLD_ID = '77777777-7777-4777-8777-777777777777';

const oldAsk = {
  id: OLD_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  starts_at: '2030-08-10T08:00:00.000Z',
  ends_at: '2030-08-10T12:00:00.000Z',
  timezone: 'UTC',
  local_date: '2030-08-10',
  kind: 'extra',
  status: 'pending',
  cover_ask_expires_at: '2030-08-09T08:00:00.000Z',
  source_pattern_id: null,
  origin: 'parent_proposed',
  sequence: 0,
} as unknown as Shift;

let ExtraShiftScreen: typeof import('../components/ExtraShiftScreen').ExtraShiftScreen;
let replaced: { data: Shift | undefined; isLoading: boolean; isError: boolean };
const calls: string[] = [];
const mockWithdraw = mock((_id: string) => {
  calls.push('withdraw');
  return Promise.resolve(oldAsk);
});
const mockCreate = mock((_input: unknown) => {
  calls.push('create');
  return Promise.resolve({ status: 'created', adopted: false, warnings: [] });
});
const mockShiftRange = mock(() => Promise.resolve([] as Shift[]));
const mockGetBusyBlocks = mock(() => Promise.resolve([] as unknown[]));
const mockShowErrorToast = mock();
const mockRouterBack = mock();

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) =>
        opts ? `${key} ${JSON.stringify(opts)}` : key,
      i18n: { language: 'en' },
    }),
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mockRouterBack, push: mock() }),
    useLocalSearchParams: () => ({
      date: '2030-08-10',
      start: '09:00',
      end: '13:00',
      carerId: CARER_ID,
      replacesShiftId: OLD_ID,
    }),
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
    useCanWriteHousehold: () => ({ canWrite: true, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: () => ({ disabled: false, reason: null }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({
      data: [
        {
          user_id: CARER_ID,
          display_name_override: 'Andrea',
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
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: () => replaced,
  }));
  mock.module('@/src/hooks/mutations/useWithdrawCoverAsk', () => ({
    useWithdrawCoverAsk: () => ({
      mutateAsync: mockWithdraw,
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateExtraShift', () => ({
    useCreateExtraShift: () => ({ mutateAsync: mockCreate, isPending: false }),
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

  ExtraShiftScreen = (await import('../components/ExtraShiftScreen'))
    .ExtraShiftScreen;
});

beforeEach(() => {
  replaced = { data: oldAsk, isLoading: false, isError: false };
  calls.length = 0;
  for (const m of [
    mockWithdraw,
    mockCreate,
    mockShiftRange,
    mockGetBusyBlocks,
    mockShowErrorToast,
    mockRouterBack,
  ]) {
    m.mockClear();
  }
  mockWithdraw.mockImplementation(() => {
    calls.push('withdraw');
    return Promise.resolve(oldAsk);
  });
  mockCreate.mockImplementation(() => {
    calls.push('create');
    return Promise.resolve({ status: 'created', adopted: false, warnings: [] });
  });
  mockShiftRange.mockImplementation(() => Promise.resolve([]));
  mockGetBusyBlocks.mockImplementation(() => Promise.resolve([]));
});

describe('ExtraShiftScreen — replacesShiftId hint', () => {
  it('names the old window and carer once the old ask has loaded', () => {
    const { getByTestId } = render(<ExtraShiftScreen />);
    const text = String(
      getByTestId('extra-shift-replaces-hint').props.children
    );
    expect(text).toContain('cover.changeAskHint');
    expect(text).toContain('"carerName":"Andrea"');
    expect(text).toContain('8:00');
    expect(text).toContain('12:00');
  });

  it('states nothing while the old ask is loading or failed', () => {
    replaced = { data: undefined, isLoading: true, isError: false };
    const loading = render(<ExtraShiftScreen />);
    expect(loading.queryByTestId('extra-shift-replaces-hint')).toBeNull();
    loading.unmount();
    replaced = { data: undefined, isLoading: false, isError: true };
    const failed = render(<ExtraShiftScreen />);
    expect(failed.queryByTestId('extra-shift-replaces-hint')).toBeNull();
  });

  it('says nothing once the old ask is no longer outstanding', () => {
    replaced = {
      data: { ...oldAsk, status: 'cancelled' } as Shift,
      isLoading: false,
      isError: false,
    };
    const { queryByTestId } = render(<ExtraShiftScreen />);
    expect(queryByTestId('extra-shift-replaces-hint')).toBeNull();
  });
});

describe('ExtraShiftScreen — withdraw then create', () => {
  it('withdraws the old ask before creating the new one', async () => {
    const { getByTestId } = render(<ExtraShiftScreen />);
    fireEvent.press(getByTestId('schedule-extra-submit'));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());
    expect(calls).toEqual(['withdraw', 'create']);
    expect(mockWithdraw).toHaveBeenCalledWith(OLD_ID);
  });

  it('never creates when the withdraw fails, and stays on screen', async () => {
    mockWithdraw.mockImplementation(() => {
      calls.push('withdraw');
      return Promise.reject(new Error('nope'));
    });
    const { getByTestId } = render(<ExtraShiftScreen />);
    fireEvent.press(getByTestId('schedule-extra-submit'));
    await waitFor(() => expect(mockShowErrorToast).toHaveBeenCalledTimes(1));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('after a create failure, a retry only creates', async () => {
    let fail = true;
    mockCreate.mockImplementation(() => {
      calls.push('create');
      if (fail) {
        fail = false;
        // API failures are toasted by the hook's onError.
        return Promise.reject({ isAxiosError: true, response: {} });
      }
      return Promise.resolve({
        status: 'created',
        adopted: false,
        warnings: [],
      });
    });
    const { getByTestId } = render(<ExtraShiftScreen />);
    fireEvent.press(getByTestId('schedule-extra-submit'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockRouterBack).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('schedule-extra-submit'));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());
    expect(calls).toEqual(['withdraw', 'create', 'create']);
  });

  it('ignores a second tap while the first send is in flight', async () => {
    let release: () => void = () => {};
    mockWithdraw.mockImplementation(() => {
      calls.push('withdraw');
      return new Promise<Shift>(resolve => {
        release = () => resolve(oldAsk);
      });
    });
    const { getByTestId } = render(<ExtraShiftScreen />);
    fireEvent.press(getByTestId('schedule-extra-submit'));
    fireEvent.press(getByTestId('schedule-extra-submit'));
    await waitFor(() => expect(mockWithdraw).toHaveBeenCalledTimes(1));
    fireEvent.press(getByTestId('schedule-extra-submit'));
    release();
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());
    expect(calls).toEqual(['withdraw', 'create']);
  });

  it('does not let the old ask flag itself as a clash', async () => {
    mockShiftRange.mockImplementation(() => Promise.resolve([oldAsk]));
    mockGetBusyBlocks.mockImplementation(() =>
      Promise.resolve([
        {
          starts_at: oldAsk.starts_at,
          ends_at: oldAsk.ends_at,
          kind: 'other_commitment',
        },
      ])
    );
    const { getByTestId, queryByTestId } = render(<ExtraShiftScreen />);
    fireEvent.press(getByTestId('schedule-extra-submit'));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalled());
    expect(mockShowErrorToast).not.toHaveBeenCalled();
    expect(queryByTestId('schedule-extra-clash-confirm')).toBeNull();
    expect(calls).toEqual(['withdraw', 'create']);
  });
});
