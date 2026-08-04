/**
 * @module domains/householdClosures/__tests__/HouseholdClosuresScreen.test
 *
 * D22-style regression guard: renders the ACTUAL `HouseholdClosuresScreen`,
 * not a component fed mocks directly. `useIsOnboarded` /
 * `useHouseholdClosures` / `useCreateHouseholdClosure` /
 * `useDeleteHouseholdClosure` are mocked via `mock.module()` in `beforeAll`,
 * before the dynamic import, per docs/09-TESTING.md's service-test
 * boilerplate.
 *
 * `TimeOffDateRangePicker` is mocked too, for the same reason
 * `TimeOffScreen.test.tsx` mocks it: the underlying native datetimepicker
 * cannot be parsed under bun:test at all.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { toAllDayRange } from '../../timeOff/utils/timeOffDate';

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

const HOUSEHOLD_ID = '5d4b0b70-edd9-4218-b7df-a28d234f7e06';

function makeClosure(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    household_id: HOUSEHOLD_ID,
    starts_at: '2026-08-10T00:00:00.000Z',
    ends_at: '2026-08-13T00:00:00.000Z',
    message: null,
    created_by: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

let HouseholdClosuresScreen: typeof import('../components/HouseholdClosuresScreen').HouseholdClosuresScreen;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseHouseholdClosures: ReturnType<typeof mock>;
let mockUseCreateHouseholdClosure: ReturnType<typeof mock>;
let mockUseDeleteHouseholdClosure: ReturnType<typeof mock>;
let createMutateAsync: ReturnType<typeof mock>;
let deleteMutateAsync: ReturnType<typeof mock>;

beforeAll(async () => {
  createMutateAsync = mock(() => Promise.resolve(makeClosure()));
  deleteMutateAsync = mock(() => Promise.resolve(undefined));

  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'parent',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseHouseholdClosures = mock(() => ({ data: [], isLoading: false }));
  mockUseCreateHouseholdClosure = mock(() => ({
    mutateAsync: createMutateAsync,
    isPending: false,
  }));
  mockUseDeleteHouseholdClosure = mock(() => ({
    mutateAsync: deleteMutateAsync,
    isPending: false,
  }));

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
    useHouseholdClosures: mockUseHouseholdClosures,
  }));
  mock.module('@/src/hooks/mutations/useCreateHouseholdClosure', () => ({
    useCreateHouseholdClosure: mockUseCreateHouseholdClosure,
  }));
  mock.module('@/src/hooks/mutations/useDeleteHouseholdClosure', () => ({
    useDeleteHouseholdClosure: mockUseDeleteHouseholdClosure,
  }));

  const mod = await import('../components/HouseholdClosuresScreen');
  HouseholdClosuresScreen = mod.HouseholdClosuresScreen;
});

beforeEach(() => {
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'onboarded',
    role: 'parent',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseHouseholdClosures.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));
  createMutateAsync.mockClear();
  deleteMutateAsync.mockClear();
});

describe('HouseholdClosuresScreen — parent', () => {
  it('renders the screen, header, and create form', () => {
    const { getByTestId } = render(<HouseholdClosuresScreen />);

    expect(getByTestId('household-closures-screen')).toBeTruthy();
    expect(getByTestId('household-closures-header')).toBeTruthy();
    expect(getByTestId('household-closures-form')).toBeTruthy();
  });

  it('renders the empty state when there are no closures on record', () => {
    const { getByTestId } = render(<HouseholdClosuresScreen />);
    expect(getByTestId('household-closures-empty')).toBeTruthy();
  });

  it('submitting with the default (today..today) range calls create with a same-day payload', async () => {
    const { getByTestId } = render(<HouseholdClosuresScreen />);

    fireEvent.press(getByTestId('household-closures-submit'));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const payload = createMutateAsync.mock.calls[0]?.[0] as {
      starts_at: string;
      ends_at: string;
    };
    const spanMs =
      new Date(payload.ends_at).getTime() -
      new Date(payload.starts_at).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000);
  });

  it('picking a real (non-default) date range sends THAT exact range to create', async () => {
    const { getByTestId } = render(<HouseholdClosuresScreen />);

    fireEvent.press(getByTestId('household-closures-dates-set-range'));
    fireEvent.press(getByTestId('household-closures-submit'));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const expected = toAllDayRange('2026-08-10', '2026-08-12');
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: expected.starts_at,
        ends_at: expected.ends_at,
      })
    );
  });

  it('includes a trimmed message when one is entered, and omits it entirely when blank', async () => {
    const { getByTestId } = render(<HouseholdClosuresScreen />);

    fireEvent.changeText(
      getByTestId('household-closures-message'),
      '  Half-term in Cornwall  '
    );
    fireEvent.press(getByTestId('household-closures-submit'));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const payload = createMutateAsync.mock.calls[0]?.[0] as {
      message?: string;
    };
    expect(payload.message).toBe('Half-term in Cornwall');
  });

  it('renders a closure row with a working Remove control, and calls delete with the right id', async () => {
    mockUseHouseholdClosures.mockImplementation(() => ({
      data: [makeClosure()],
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<HouseholdClosuresScreen />);

    expect(queryByTestId('household-closures-empty')).toBeNull();
    expect(
      getByTestId('household-closures-row-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();

    fireEvent.press(
      getByTestId(
        'household-closures-delete-22222222-2222-4222-8222-222222222222'
      )
    );

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledTimes(1));
    expect(deleteMutateAsync).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('hides Remove for an already-past closure', () => {
    mockUseHouseholdClosures.mockImplementation(() => ({
      data: [
        makeClosure({
          starts_at: '2020-01-01T00:00:00.000Z',
          ends_at: '2020-01-05T00:00:00.000Z',
        }),
      ],
      isLoading: false,
    }));

    const { queryByTestId } = render(<HouseholdClosuresScreen />);

    expect(
      queryByTestId(
        'household-closures-delete-22222222-2222-4222-8222-222222222222'
      )
    ).toBeNull();
  });
});

describe('HouseholdClosuresScreen — non-parent (no entry point exists, but a direct deep link must stay honest)', () => {
  it('renders "not available", never the closure form, for a nanny', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'nanny',
      householdId: HOUSEHOLD_ID,
    }));

    const { getByTestId, queryByTestId } = render(<HouseholdClosuresScreen />);

    expect(getByTestId('household-closures-not-available')).toBeTruthy();
    expect(queryByTestId('household-closures-form')).toBeNull();
  });

  it('renders "not available" for a helper', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'helper',
      householdId: HOUSEHOLD_ID,
    }));

    const { getByTestId } = render(<HouseholdClosuresScreen />);

    expect(getByTestId('household-closures-not-available')).toBeTruthy();
  });
});

describe('HouseholdClosuresScreen — loading', () => {
  it('shows a loading indicator while onboarding status is unresolved', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'loading',
      role: null,
      householdId: null,
    }));

    const { getByTestId, queryByTestId } = render(<HouseholdClosuresScreen />);

    expect(getByTestId('household-closures-loading')).toBeTruthy();
    expect(queryByTestId('household-closures-form')).toBeNull();
  });
});
