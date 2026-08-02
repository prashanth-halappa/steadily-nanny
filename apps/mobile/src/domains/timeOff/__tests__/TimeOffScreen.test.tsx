/**
 * @module domains/timeOff/__tests__/TimeOffScreen.test
 *
 * D22 regression guard: renders the ACTUAL `TimeOffScreen`, not a component
 * fed mocks directly — the failure mode being protected against is the
 * D15-class bug ("green test, dead feature"): a form/list that works in
 * isolation but is never actually wired to a mutation, or never actually
 * reachable for the wrong role. `useIsOnboarded` / `useTimeOff` /
 * `useRequestTimeOff` / `useCancelTimeOff` are mocked via `mock.module()` in
 * `beforeAll`, before the dynamic import, per docs/09-TESTING.md's
 * service-test boilerplate.
 *
 * D30: also mocks `useBusyBlocks` (refetch on submit) and
 * `@rn-primitives/alert-dialog` so conflict / check-failed confirmations
 * can be asserted through the real form.
 *
 * `TimeOffDateRangePicker` is mocked too — not to dodge the acceptance bar,
 * but because `@react-native-community/datetimepicker` cannot be parsed
 * under bun:test at all (see that component's header comment); the mock
 * exposes a single "set range" control so the test can drive a real,
 * non-default date pair through the real submit handler and assert the
 * real payload the mutation receives.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { toAllDayRange } from '../utils/timeOffDate';

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

mock.module('@/src/domains/timeOff/components/TimeOffDateRangePicker', () => {
  const React = require('react');
  return {
    TimeOffDateRangePicker: ({
      onChange,
      testID,
    }: {
      onChange: (start: string, end: string) => void;
      testID?: string;
    }) =>
      React.createElement('TouchableOpacity', {
        testID: `${testID ?? 'time-off-date-range'}-set-range`,
        onPress: () => onChange('2026-08-10', '2026-08-12'),
      }),
  };
});

// Same stand-in as ManageHouseholdScreen.test — @rn-primitives/alert-dialog
// .mjs distribution isn't pre-compiled for bun:test.
mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const Ctx = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });

  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const setOpen = (next: boolean) => onOpenChange?.(next);
      return React.createElement(
        Ctx.Provider,
        { value: { open: open ?? false, setOpen } },
        children
      );
    },
    Trigger: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children: React.ReactNode;
      onPress?: (e: unknown) => void;
      disabled?: boolean;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          disabled,
          onPress: (e: unknown) => {
            onPress?.(e);
            if (!disabled) setOpen(true);
          },
        },
        children
      );
    },
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const { open } = React.useContext(Ctx);
      return open ? React.createElement('View', props, children) : null;
    },
    Content: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('View', props, children),
    Title: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Description: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    Action: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    useRootContext: () => React.useContext(Ctx),
  };
});

const NANNY_ID = '11111111-1111-4111-8111-111111111111';

function makeTimeOff(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: NANNY_ID,
    starts_at: '2026-08-10T00:00:00.000Z',
    ends_at: '2026-08-13T00:00:00.000Z',
    all_day: true,
    message: null,
    status: 'confirmed',
    ical_uid: 'time-off-1@steadily',
    sequence: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

let TimeOffScreen: typeof import('../components/TimeOffScreen').TimeOffScreen;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseTimeOff: ReturnType<typeof mock>;
let mockUseRequestTimeOff: ReturnType<typeof mock>;
let mockUseCancelTimeOff: ReturnType<typeof mock>;
let mockUseBusyBlocks: ReturnType<typeof mock>;
let requestMutateAsync: ReturnType<typeof mock>;
let cancelMutateAsync: ReturnType<typeof mock>;
let busyRefetch: ReturnType<typeof mock>;

beforeAll(async () => {
  requestMutateAsync = mock(() => Promise.resolve(makeTimeOff()));
  cancelMutateAsync = mock(() =>
    Promise.resolve(makeTimeOff({ status: 'cancelled' }))
  );
  busyRefetch = mock(() =>
    Promise.resolve({ data: [], error: null, isError: false })
  );

  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: '5d4b0b70-edd9-4218-b7df-a28d234f7e06',
  }));
  mockUseTimeOff = mock(() => ({ data: [], isLoading: false }));
  mockUseRequestTimeOff = mock(() => ({
    mutateAsync: requestMutateAsync,
    isPending: false,
  }));
  mockUseCancelTimeOff = mock(() => ({
    mutateAsync: cancelMutateAsync,
    isPending: false,
  }));
  mockUseBusyBlocks = mock(() => ({
    data: [],
    refetch: busyRefetch,
    isLoading: false,
  }));

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useTimeOff', () => ({
    useTimeOff: mockUseTimeOff,
  }));
  mock.module('@/src/hooks/mutations/useRequestTimeOff', () => ({
    useRequestTimeOff: mockUseRequestTimeOff,
  }));
  mock.module('@/src/hooks/mutations/useCancelTimeOff', () => ({
    useCancelTimeOff: mockUseCancelTimeOff,
  }));
  mock.module('@/src/hooks/queries/useBusyBlocks', () => ({
    useBusyBlocks: mockUseBusyBlocks,
  }));

  const mod = await import('../components/TimeOffScreen');
  TimeOffScreen = mod.TimeOffScreen;
});

beforeEach(() => {
  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    isInitialized: true,
  } as never);
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: '5d4b0b70-edd9-4218-b7df-a28d234f7e06',
  }));
  mockUseTimeOff.mockImplementation(() => ({ data: [], isLoading: false }));
  busyRefetch.mockReset();
  busyRefetch.mockImplementation(() =>
    Promise.resolve({ data: [], error: null, isError: false })
  );
  requestMutateAsync.mockClear();
  cancelMutateAsync.mockClear();
});

describe('TimeOffScreen — nanny', () => {
  it('renders the screen, header, and request form', () => {
    const { getByTestId } = render(<TimeOffScreen />);

    expect(getByTestId('time-off-screen')).toBeTruthy();
    expect(getByTestId('time-off-header')).toBeTruthy();
    expect(getByTestId('time-off-request-form')).toBeTruthy();
  });

  it('submitting with the default (today..today) range calls the mutation with a same-day all-day payload — no invented approval status', async () => {
    const { getByTestId } = render(<TimeOffScreen />);

    fireEvent.press(getByTestId('time-off-request-submit'));

    await waitFor(() => expect(requestMutateAsync).toHaveBeenCalledTimes(1));
    const payload = requestMutateAsync.mock.calls[0]?.[0] as {
      starts_at: string;
      ends_at: string;
      all_day: boolean;
      status?: unknown;
    };
    expect(payload.all_day).toBe(true);
    expect(payload.status).toBeUndefined();
    const spanMs =
      new Date(payload.ends_at).getTime() -
      new Date(payload.starts_at).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000);
    expect(busyRefetch).toHaveBeenCalled();
  });

  it('picking a real (non-default) date range and submitting sends THAT exact range to the mutation — not just a label change', async () => {
    const { getByTestId } = render(<TimeOffScreen />);

    fireEvent.press(getByTestId('time-off-request-dates-set-range'));
    fireEvent.press(getByTestId('time-off-request-submit'));

    await waitFor(() => expect(requestMutateAsync).toHaveBeenCalledTimes(1));
    const expected = toAllDayRange('2026-08-10', '2026-08-12');
    expect(requestMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: expected.starts_at,
        ends_at: expected.ends_at,
        all_day: true,
      })
    );
  });

  it('includes a trimmed message when one is entered, and omits it entirely when blank', async () => {
    const { getByTestId } = render(<TimeOffScreen />);

    fireEvent.changeText(
      getByTestId('time-off-request-message'),
      '  Visiting family  '
    );
    fireEvent.press(getByTestId('time-off-request-submit'));

    await waitFor(() => expect(requestMutateAsync).toHaveBeenCalledTimes(1));
    const payload = requestMutateAsync.mock.calls[0]?.[0] as {
      message?: string;
    };
    expect(payload.message).toBe('Visiting family');
  });

  it('D30: overlapping other_commitment requires confirm before mutate', async () => {
    const expected = toAllDayRange('2026-08-10', '2026-08-12');
    busyRefetch.mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            starts_at: '2026-08-11T09:00:00.000Z',
            ends_at: '2026-08-11T17:00:00.000Z',
            kind: 'other_commitment',
          },
        ],
        error: null,
        isError: false,
      })
    );

    const { getByTestId, queryByTestId } = render(<TimeOffScreen />);

    fireEvent.press(getByTestId('time-off-request-dates-set-range'));
    fireEvent.press(getByTestId('time-off-request-submit'));

    await waitFor(() =>
      expect(getByTestId('time-off-conflict-confirm')).toBeTruthy()
    );
    expect(requestMutateAsync).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('time-off-conflict-confirm'));

    await waitFor(() => expect(requestMutateAsync).toHaveBeenCalledTimes(1));
    expect(requestMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: expected.starts_at,
        ends_at: expected.ends_at,
      })
    );
    expect(queryByTestId('time-off-conflict-confirm')).toBeNull();
  });

  it('D30: busy check failure requires acknowledgement before mutate — never silent submit', async () => {
    busyRefetch.mockImplementation(() =>
      Promise.resolve({
        data: undefined,
        error: new Error('network'),
        isError: true,
      })
    );

    const { getByTestId } = render(<TimeOffScreen />);

    fireEvent.press(getByTestId('time-off-request-submit'));

    await waitFor(() =>
      expect(getByTestId('time-off-check-failed-confirm')).toBeTruthy()
    );
    expect(requestMutateAsync).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('time-off-check-failed-confirm'));

    await waitFor(() => expect(requestMutateAsync).toHaveBeenCalledTimes(1));
  });

  it('D30: cancelling the conflict dialog does not call the mutation', async () => {
    busyRefetch.mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            starts_at: '2026-08-11T09:00:00.000Z',
            ends_at: '2026-08-11T17:00:00.000Z',
            kind: 'other_commitment',
          },
        ],
        error: null,
        isError: false,
      })
    );

    const { getByTestId } = render(<TimeOffScreen />);

    fireEvent.press(getByTestId('time-off-request-dates-set-range'));
    fireEvent.press(getByTestId('time-off-request-submit'));

    await waitFor(() =>
      expect(getByTestId('time-off-conflict-cancel')).toBeTruthy()
    );
    fireEvent.press(getByTestId('time-off-conflict-cancel'));

    expect(requestMutateAsync).not.toHaveBeenCalled();
  });

  it('renders the empty state when there is no time off on record', () => {
    const { getByTestId } = render(<TimeOffScreen />);
    expect(getByTestId('time-off-empty')).toBeTruthy();
  });

  it('renders a confirmed row with a working Cancel control, and calls the cancel mutation with the right id', async () => {
    mockUseTimeOff.mockImplementation(() => ({
      data: [makeTimeOff()],
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<TimeOffScreen />);

    expect(queryByTestId('time-off-empty')).toBeNull();
    expect(
      getByTestId('time-off-row-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();
    expect(
      getByTestId('time-off-status-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();

    fireEvent.press(
      getByTestId('time-off-cancel-22222222-2222-4222-8222-222222222222')
    );

    await waitFor(() => expect(cancelMutateAsync).toHaveBeenCalledTimes(1));
    expect(cancelMutateAsync).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('hides the Cancel control for an already-cancelled row — cancelling twice implies unfinished business that does not exist', () => {
    mockUseTimeOff.mockImplementation(() => ({
      data: [makeTimeOff({ status: 'cancelled' })],
      isLoading: false,
    }));

    const { queryByTestId } = render(<TimeOffScreen />);

    expect(
      queryByTestId('time-off-cancel-22222222-2222-4222-8222-222222222222')
    ).toBeNull();
  });
});

describe('TimeOffScreen — parent (no entry point exists, but a direct deep link must stay honest)', () => {
  it('renders "not available", never the nanny request form, for a parent', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'parent',
      householdId: '5d4b0b70-edd9-4218-b7df-a28d234f7e06',
    }));

    const { getByTestId, queryByTestId } = render(<TimeOffScreen />);

    expect(getByTestId('time-off-not-available')).toBeTruthy();
    expect(queryByTestId('time-off-request-form')).toBeNull();
  });
});
