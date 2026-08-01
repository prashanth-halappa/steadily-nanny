/**
 * @module domains/schedule/__tests__/ScheduleShiftsScreen.test
 *
 * Covers `ScheduleShiftsScreen`: the current week's materialised shifts,
 * grouped by day. `GET /v1/households/:householdId/shifts` is being built
 * concurrently by another agent — until it ships, calls 404 — so the most
 * important case here is that the screen renders an honest "not available
 * yet" state (not a crash, not a generic error screen) when
 * `isShiftsRouteUnavailable(error)` is true.
 *
 * `useShiftsRange` / `useIsOnboarded` / `isShiftsRouteUnavailable` are
 * mocked via `mock.module()` in `beforeAll`, BEFORE the dynamic import of
 * the component under test, per docs/09-TESTING.md's service-test
 * boilerplate (mock.module must be registered before the module that
 * depends on it is imported).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

// LoadingIndicator's require('@/assets/splash.png') breaks bundling under
// bun:test (see loading-indicator.test.tsx's header comment) — mock it out
// to a plain marker View, same as that file does.
mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

let ScheduleShiftsScreen: typeof import('../components/ScheduleShiftsScreen').ScheduleShiftsScreen;
let mockUseShiftsRange: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockIsShiftsRouteUnavailable: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function makeShift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    household_id: HOUSEHOLD_ID,
    carer_id: '33333333-3333-4333-8333-333333333333',
    starts_at: '2026-08-03T13:00:00.000Z',
    ends_at: '2026-08-03T21:00:00.000Z',
    timezone: 'America/New_York',
    local_date: '2026-08-03',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  mockUseShiftsRange = mock(() => ({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
  }));
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'parent',
    householdId: HOUSEHOLD_ID,
  }));
  mockIsShiftsRouteUnavailable = mock(() => false);

  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
    isShiftsRouteUnavailable: mockIsShiftsRouteUnavailable,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));

  const mod = await import('../components/ScheduleShiftsScreen');
  ScheduleShiftsScreen = mod.ScheduleShiftsScreen;
});

describe('ScheduleShiftsScreen', () => {
  it('renders shifts grouped/listed with the right count when useShiftsRange returns data', () => {
    const shifts = [
      makeShift({ id: 'shift-mon', local_date: '2026-08-03' }),
      makeShift({
        id: 'shift-tue',
        local_date: '2026-08-04',
        status: 'pending',
      }),
    ];
    mockUseShiftsRange.mockImplementation(() => ({
      data: shifts,
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-screen')).toBeTruthy();
    expect(getByTestId('schedule-shifts-list')).toBeTruthy();
    expect(getByTestId('schedule-shift-shift-mon')).toBeTruthy();
    expect(getByTestId('schedule-shift-status-shift-mon')).toBeTruthy();
    expect(getByTestId('schedule-shift-shift-tue')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-empty')).toBeNull();
    expect(queryByTestId('schedule-shifts-unavailable')).toBeNull();
  });

  it('renders a short-notice pill alongside the status pill when is_short_notice is true', () => {
    const shifts = [
      makeShift({ id: 'shift-sn', is_short_notice: true, status: 'pending' }),
    ];
    mockUseShiftsRange.mockImplementation(() => ({
      data: shifts,
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shift-status-shift-sn')).toBeTruthy();
    expect(getByTestId('schedule-shift-short-notice-shift-sn')).toBeTruthy();
  });

  it('renders the empty state (not the unavailable state) when the query returns an empty array with no error', () => {
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-empty')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-unavailable')).toBeNull();
    expect(queryByTestId('schedule-shifts-list')).toBeNull();
  });

  it('renders the unavailable state (not empty, not crash) when isShiftsRouteUnavailable(error) is true', () => {
    const notFoundError = { response: { status: 404 } };
    mockUseShiftsRange.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: notFoundError,
    }));
    mockIsShiftsRouteUnavailable.mockImplementation(
      (error: unknown) => error === notFoundError
    );

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(mockIsShiftsRouteUnavailable).toHaveBeenCalledWith(notFoundError);
    expect(getByTestId('schedule-shifts-unavailable')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-empty')).toBeNull();
    expect(queryByTestId('schedule-shifts-list')).toBeNull();
  });

  it('does not crash and still renders the screen root while onboarding/household resolution is loading', () => {
    mockUseIsOnboarded.mockImplementationOnce(() => ({
      status: 'loading',
      role: null,
      householdId: null,
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    }));

    const { getByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-screen')).toBeTruthy();
  });
});
