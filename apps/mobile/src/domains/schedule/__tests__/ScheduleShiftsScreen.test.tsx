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
 * `useShiftsRange` / `useActiveHousehold` / `isShiftsRouteUnavailable` are
 * mocked via `mock.module()` in `beforeAll`, BEFORE the dynamic import of
 * the component under test, per docs/09-TESTING.md's service-test
 * boilerplate (mock.module must be registered before the module that
 * depends on it is imported).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, within } from '@testing-library/react-native';
import {
  CALENDAR_VIEWS,
  useCalendarViewStore,
} from '@/src/store/calendarViewStore';

// The global `react-native` mock's `StyleSheet.flatten` (bun.setup.ts) is an
// identity function, not a real merge — typography components' `style` prop
// is an array (`[base, weight, tabular, caller]`), so `StyleSheet.flatten`
// leaves it unflattened. Merge it by hand for style assertions here.
function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

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

const mockUseHouseholdTimeOff: ReturnType<typeof mock> = mock(() => ({
  data: [],
  isLoading: false,
  isError: false,
  error: null,
  refetch: mock(() => Promise.resolve()),
}));
mock.module('@/src/hooks/queries/useHouseholdTimeOff', () => ({
  useHouseholdTimeOff: () => mockUseHouseholdTimeOff(),
}));

// AgendaView resolves carer names off this — an empty household keeps its
// existing single-carer-shaped assertions below unaffected (showCarerNames
// only flips true at 2+ nanny/helper members).
mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: [], isLoading: false }),
}));

// Mutable so the deep-link cases below can put a `householdId` on the link;
// every other case in this file renders with no params, as before.
let mockSearchParams: Record<string, unknown> = {};

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
  useLocalSearchParams: () => mockSearchParams,
  router: { push: mock(), replace: mock(), back: mock() },
}));

const mockShowInfoToast = mock();
mock.module('@/src/lib/toast', () => ({
  showInfoToast: mockShowInfoToast,
  showSuccessToast: mock(),
  showErrorToast: mock(),
  showWarningToast: mock(),
  useToast: () => ({ show: mock() }),
}));

const mockClosuresRefetch = mock(() => Promise.resolve());
mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
  useHouseholdClosures: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: mockClosuresRefetch,
  }),
}));

// AgendaView and ShiftRow now ask whether this household still takes writes
// (a removed member's cover actions must not sit there live). That is a real
// `useQuery`, and this file renders without a QueryClientProvider.
mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
  useCanWriteHousehold: () => ({
    canWrite: true,
    isPastMember: false,
    isLoading: false,
  }),
}));
mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: () => ({ data: [], isLoading: false }),
}));

const mockUseHouseholdCarers: ReturnType<typeof mock> = mock(() => ({
  data: [],
  isLoading: false,
  isError: false,
  refetch: mock(() => Promise.resolve()),
}));
mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: () => mockUseHouseholdCarers(),
}));

mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
  useCreateParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));

mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
  useRemoveParentCover: () => ({
    mutateAsync: async () => {},
    isPending: false,
  }),
}));

let ScheduleShiftsScreen: typeof import('../components/ScheduleShiftsScreen').ScheduleShiftsScreen;
let mockUseShiftsRange: ReturnType<typeof mock>;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockIsShiftsRouteUnavailable: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseUserProfile: ReturnType<typeof mock>;
let mockUseHouseholdCommitments: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_HOUSEHOLD_ID = '99999999-9999-4999-8999-999999999999';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// A commitment covering every weekday, matching no shift — the "07:00-13:00
// every weekday, nothing booked" shape from the trust-breaker bug report.
function makeCommitment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: COMMITMENT_ID,
    child_id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    kind: 'other',
    label: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    start_time: '07:00:00',
    end_time: '13:00:00',
    starts_on: null,
    ends_on: null,
    exdates: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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
  mockUseActiveHousehold = mock(() => ({
    household: { id: HOUSEHOLD_ID, week_starts_on: 1 },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID }],
    pastHouseholds: [],
    setActiveHouseholdId: mock(),
    isLoading: false,
  }));
  mockIsShiftsRouteUnavailable = mock(() => false);
  mockUseIsOnboarded = mock(() => ({ role: 'parent', status: 'onboarded' }));
  mockUseHouseholdCommitments = mock(() => ({
    data: [],
    isLoading: false,
    isError: false,
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: mockUseHouseholdCommitments,
  }));

  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
    isShiftsRouteUnavailable: mockIsShiftsRouteUnavailable,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));
  mockUseUserProfile = mock(() => ({
    data: { timezone: 'America/New_York', week_starts_on: 1 },
    isLoading: false,
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: mockUseUserProfile,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));

  const mod = await import('../components/ScheduleShiftsScreen');
  ScheduleShiftsScreen = mod.ScheduleShiftsScreen;
});

beforeEach(() => {
  // Every case but the deep-link ones renders with a bare link.
  mockSearchParams = {};
  mockShowInfoToast.mockClear();
  // Default back to zero carers — only the S7 per-carer-lead tests override
  // this, and every other test in this file is written expecting it.
  mockUseHouseholdCarers.mockImplementation(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: mock(() => Promise.resolve()),
  }));
  mockUseHouseholdTimeOff.mockImplementation(() => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: mock(() => Promise.resolve()),
  }));
});

describe('ScheduleShiftsScreen', () => {
  it('fetches shifts for the ACTIVE household, not a hardcoded/first one (Wave B)', () => {
    render(<ScheduleShiftsScreen />);

    expect(mockUseShiftsRange).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      expect.any(String),
      expect.any(String)
    );
  });

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
    expect(getByTestId('calendar-view-switcher')).toBeTruthy();
    expect(getByTestId('schedule-shifts-list')).toBeTruthy();
    expect(getByTestId('schedule-shift-shift-mon')).toBeTruthy();
    // docs/design/01-LAWS.md: a confirmed row is a settled fact — no StatusPill.
    expect(queryByTestId('schedule-shift-status-shift-mon')).toBeNull();
    expect(getByTestId('schedule-shift-shift-tue')).toBeTruthy();
    expect(getByTestId('schedule-shift-status-shift-tue')).toBeTruthy();
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
      refetch: mock(() => Promise.resolve()),
    }));
    mockIsShiftsRouteUnavailable.mockImplementation(
      (error: unknown) => error === notFoundError
    );

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(mockIsShiftsRouteUnavailable).toHaveBeenCalledWith(notFoundError);
    expect(getByTestId('schedule-shifts-unavailable')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-empty')).toBeNull();
    expect(queryByTestId('schedule-shifts-list')).toBeNull();
    expect(queryByTestId('schedule-shifts-error')).toBeNull();
  });

  it('offers retry via ErrorState when the shifts query errors for a non-404 reason', () => {
    const networkError = { response: { status: 500 } };
    const refetch = mock(() => Promise.resolve());
    mockUseShiftsRange.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: networkError,
      refetch,
    }));
    mockIsShiftsRouteUnavailable.mockImplementation(() => false);

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-error')).toBeTruthy();
    expect(getByTestId('error-state')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-unavailable')).toBeNull();
    expect(queryByTestId('schedule-shifts-empty')).toBeNull();

    fireEvent.press(getByTestId('error-state-retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('does not crash and still renders the screen root while onboarding/household resolution is loading', () => {
    mockUseActiveHousehold.mockImplementationOnce(() => ({
      household: null,
      householdId: null,
      households: [],
      setActiveHouseholdId: mock(),
      isLoading: true,
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

  it('shows the back button by default (showBack=true)', () => {
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-back')).toBeTruthy();
  });

  it('hides the back button when showBack={false}', () => {
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { queryByTestId } = render(<ScheduleShiftsScreen showBack={false} />);

    expect(queryByTestId('schedule-shifts-back')).toBeNull();
  });

  it('shows Add a one-off shift for parent roles', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-add-extra')).toBeTruthy();
  });

  it('hides Add a one-off shift for a REMOVED parent (past member)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
      isPastMember: true,
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(queryByTestId('schedule-shifts-add-extra')).toBeNull();
  });

  it('hides Add a one-off shift for nannies', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'nanny',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(queryByTestId('schedule-shifts-add-extra')).toBeNull();
  });

  it('REGRESSION P0-8: Agenda resolves the SAME timezone as the Week ribbon (household-first, not Agenda-profile-only)', () => {
    // Household is America/New_York (EDT, UTC-4 in August); profile is
    // Asia/Kolkata (UTC+5:30) — ~9.5h apart, so a wrong fallback chain on
    // either view is impossible to miss.
    mockUseActiveHousehold.mockImplementation(() => ({
      household: {
        id: HOUSEHOLD_ID,
        timezone: 'America/New_York',
        week_starts_on: 1,
      },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID }],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));
    mockUseUserProfile.mockImplementation(() => ({
      data: { timezone: 'Asia/Kolkata', week_starts_on: 1 },
      isLoading: false,
    }));
    const shifts = [
      makeShift({
        id: 'shift-tz',
        local_date: '2026-08-03', // Monday
        starts_at: '2026-08-03T13:00:00.000Z',
        ends_at: '2026-08-03T21:00:00.000Z',
        status: 'confirmed',
      }),
    ];
    mockUseShiftsRange.mockImplementation(() => ({
      data: shifts,
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId, getByText } = render(<ScheduleShiftsScreen />);

    // Agenda (default view): 13:00Z-21:00Z in America/New_York is 9:00 AM-5:00 PM.
    // Before the fix, Agenda used profile tz only and would show 18:30-02:30.
    // The ZONE is what this regression guards — the literals moved from "09:00"
    // to "9:00 AM" when schedule screens adopted the app-wide device-locale
    // clock format (GOLDEN-FIXES #21), which is a display change, not a zone one.
    expect(getByText(/9:00\s*AM/)).toBeTruthy();
    expect(getByText(/5:00\s*PM/)).toBeTruthy();

    fireEvent.press(getByTestId('calendar-view-week_ribbon'));

    // Monday (dow=1), hour 9 is occupied in America/New_York too — same
    // resolved zone as Agenda, not a second, independent fallback chain.
    expect(getByTestId('week-ribbon-cell-1-9').props.accessibilityLabel).toBe(
      'confirmed'
    );
  });

  // 3-E1: the week RANGE this screen pages through is anchored on the
  // household's `week_starts_on`. The ribbon's column order used to be
  // rotated by `profile.data.week_starts_on` — a per-USER display
  // preference — so for a Sunday-start household whose parent had the
  // Monday display preference, the first column was a Monday while the
  // range being shown started on the Sunday. Same screen, two different
  // first days of the week.
  it('REGRESSION: the week ribbon’s first column is the HOUSEHOLD’s week start, not the user profile’s', () => {
    mockUseActiveHousehold.mockImplementation(() => ({
      household: {
        id: HOUSEHOLD_ID,
        timezone: 'America/New_York',
        week_starts_on: 0,
      },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID }],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));
    // Deliberately DISAGREES with the household — this is the value the
    // ribbon must now ignore.
    mockUseUserProfile.mockImplementation(() => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }));
    // One shift so the ribbon renders at all — an empty week shows the
    // empty state instead, and there would be no columns to assert on.
    mockUseShiftsRange.mockImplementation(() => ({
      data: [
        makeShift({
          id: 'shift-ribbon-order',
          local_date: '2026-08-03',
          starts_at: '2026-08-03T13:00:00.000Z',
          ends_at: '2026-08-03T21:00:00.000Z',
          status: 'confirmed',
        }),
      ],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId, getAllByText } = render(<ScheduleShiftsScreen />);
    fireEvent.press(getByTestId('calendar-view-week_ribbon'));

    // i18n echoes keys in tests, so each column header renders as
    // `weekdayShort.<postgres dow>` in rendered (column) order.
    const headers = getAllByText(/^weekdayShort\.\d$/).map(
      node => node.props.children
    );
    expect(headers.slice(0, 3)).toEqual([
      'weekdayShort.0',
      'weekdayShort.1',
      'weekdayShort.2',
    ]);
  });

  // Superseded: this used to assert Small/14/600 because the action sat
  // beside the H1 and had to stay lighter than it. It no longer sits there
  // (see the '"Add a one-off shift" is a control' describe below), so the
  // constraint it encoded is gone — it is a Button now, and the only thing
  // still worth asserting is that it carries the label.
  it('P1: "Add a one-off shift" still carries its label after the move off the heading row', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-add-extra').props.children).toBe(
      'shifts.addExtra'
    );
  });

  describe('S12: role-forked H1 (same screen, two voices)', () => {
    it('shows the nanny voice — "This week" — for role nanny', () => {
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'nanny',
        status: 'onboarded',
      }));
      mockUseShiftsRange.mockImplementation(() => ({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }));

      const { getByText, queryByText } = render(<ScheduleShiftsScreen />);

      expect(getByText('shifts.nannyHeading')).toBeTruthy();
      expect(queryByText('shifts.parentHeading')).toBeNull();
    });

    it('shows the parent voice — "Schedule" — for role parent', () => {
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'parent',
        status: 'onboarded',
      }));
      mockUseShiftsRange.mockImplementation(() => ({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }));

      const { getByText, queryByText } = render(<ScheduleShiftsScreen />);

      expect(getByText('shifts.parentHeading')).toBeTruthy();
      expect(queryByText('shifts.nannyHeading')).toBeNull();
    });

    it('renders the lead line for the nanny and the parent', () => {
      mockUseShiftsRange.mockImplementation(() => ({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }));

      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'nanny',
        status: 'onboarded',
      }));
      const nanny = render(<ScheduleShiftsScreen />);
      expect(nanny.getByTestId('schedule-lead')).toBeTruthy();
      nanny.unmount();

      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'parent',
        status: 'onboarded',
      }));
      const parent = render(<ScheduleShiftsScreen />);
      expect(parent.getByTestId('schedule-lead')).toBeTruthy();
    });

    it('renders the no-carer lead, not "lead.parent" with an empty name, when the household has no carer on record', () => {
      // `useHouseholdCarers` is mocked to `data: []` for this whole file —
      // the same shape a household sees once its only carer's account is
      // deleted (her `household_members` row is destroyed, so she can never
      // come back from this query). `ParentWeekView` already branches on
      // this with a `lead.parentNoCarer` key; this screen must match it
      // instead of interpolating `t('lead.parent', { name: '' })`, which
      // renders " is with the children N days this week." with a leading
      // space and no subject.
      mockUseShiftsRange.mockImplementation(() => ({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }));
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'parent',
        status: 'onboarded',
      }));

      const { getByTestId } = render(<ScheduleShiftsScreen />);

      expect(getByTestId('schedule-lead').props.children).toBe(
        'lead.parentNoCarer'
      );
    });

    // S7: naming only the first carer while counting every carer's shifts
    // was a wrong factual claim the moment a second nanny worked days of
    // her own — two active carers get a per-carer breakdown instead.
    it('S7: two carers get a per-carer breakdown, never one name for the combined total', () => {
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'parent',
        status: 'onboarded',
      }));
      mockUseHouseholdCarers.mockImplementation(() => ({
        data: [
          {
            user_id: 'priya-id',
            display_name_override: 'Priya',
            profile_name: null,
          },
          {
            user_id: 'maya-id',
            display_name_override: 'Maya',
            profile_name: null,
          },
        ],
        isLoading: false,
        isError: false,
        refetch: mock(() => Promise.resolve()),
      }));
      mockUseShiftsRange.mockImplementation(() => ({
        data: [
          makeShift({
            id: 's1',
            carer_id: 'priya-id',
            local_date: '2026-08-03',
          }),
          makeShift({
            id: 's2',
            carer_id: 'maya-id',
            local_date: '2026-08-04',
          }),
        ],
        isLoading: false,
        isError: false,
        error: null,
      }));

      const { getByTestId } = render(<ScheduleShiftsScreen />);

      // The global react-i18next mock echoes the key and drops params, so
      // two per-carer segments joined render as the key twice, NOT the
      // single-carer `lead.parent` key.
      expect(getByTestId('schedule-lead').props.children).toBe(
        'week.leadPerCarer · week.leadPerCarer'
      );
    });

    // S11: a nanny had no pattern-level surface at all — this is her one
    // link into it from her Schedule tab root.
    it('S11: a nanny sees the "Your usual week" link; a parent does not', () => {
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'nanny',
        status: 'onboarded',
      }));
      const nanny = render(<ScheduleShiftsScreen />);
      expect(nanny.getByTestId('schedule-shifts-usual-week-link')).toBeTruthy();
      nanny.unmount();

      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'parent',
        status: 'onboarded',
      }));
      const parent = render(<ScheduleShiftsScreen />);
      expect(
        parent.queryByTestId('schedule-shifts-usual-week-link')
      ).toBeNull();
    });

    it('S7: a single carer still gets the ordinary lead.parent line, not the per-carer key', () => {
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'parent',
        status: 'onboarded',
      }));
      mockUseHouseholdCarers.mockImplementation(() => ({
        data: [
          {
            user_id: 'priya-id',
            display_name_override: 'Priya',
            profile_name: null,
          },
        ],
        isLoading: false,
        isError: false,
        refetch: mock(() => Promise.resolve()),
      }));
      mockUseShiftsRange.mockImplementation(() => ({
        data: [makeShift({ id: 's1', carer_id: 'priya-id' })],
        isLoading: false,
        isError: false,
        error: null,
      }));

      const { getByTestId } = render(<ScheduleShiftsScreen />);

      expect(getByTestId('schedule-lead').props.children).toBe('lead.parent');
    });

    // The week-total note ("Everyone's hours added together") is true only
    // when the viewer sees every carer's shifts — parent/helper with 2+
    // carers. A nanny's API scope is her own rows, so the same note would
    // be a false claim on her pay-facing screen.
    describe('week-total multi-carer note (parent/helper only)', () => {
      const twoCarers = [
        {
          user_id: 'priya-id',
          display_name_override: 'Priya',
          profile_name: null,
        },
        {
          user_id: 'maya-id',
          display_name_override: 'Maya',
          profile_name: null,
        },
      ];
      const twoCarerShifts = [
        makeShift({
          id: 's1',
          carer_id: 'priya-id',
          local_date: '2026-08-03',
        }),
        makeShift({
          id: 's2',
          carer_id: 'maya-id',
          local_date: '2026-08-04',
        }),
      ];

      it('parent voice + 2 carers: shows the week-total note', () => {
        mockUseIsOnboarded.mockImplementation(() => ({
          role: 'parent',
          status: 'onboarded',
        }));
        mockUseHouseholdCarers.mockImplementation(() => ({
          data: twoCarers,
          isLoading: false,
          isError: false,
          refetch: mock(() => Promise.resolve()),
        }));
        mockUseShiftsRange.mockImplementation(() => ({
          data: twoCarerShifts,
          isLoading: false,
          isError: false,
          error: null,
        }));

        const { getByTestId } = render(<ScheduleShiftsScreen />);

        expect(getByTestId('schedule-week-total-note').props.children).toBe(
          'shifts.weekTotalAllCarers'
        );
      });

      it('parent voice + 1 carer: does not show the week-total note', () => {
        mockUseIsOnboarded.mockImplementation(() => ({
          role: 'parent',
          status: 'onboarded',
        }));
        mockUseHouseholdCarers.mockImplementation(() => ({
          data: [
            {
              user_id: 'priya-id',
              display_name_override: 'Priya',
              profile_name: null,
            },
          ],
          isLoading: false,
          isError: false,
          refetch: mock(() => Promise.resolve()),
        }));
        mockUseShiftsRange.mockImplementation(() => ({
          data: [
            makeShift({
              id: 's1',
              carer_id: 'priya-id',
              local_date: '2026-08-03',
            }),
          ],
          isLoading: false,
          isError: false,
          error: null,
        }));

        const { queryByTestId } = render(<ScheduleShiftsScreen />);

        expect(queryByTestId('schedule-week-total-note')).toBeNull();
      });

      it('nanny voice + 2 carers: does not show the week-total note (her hours are scoped to her own)', () => {
        mockUseIsOnboarded.mockImplementation(() => ({
          role: 'nanny',
          status: 'onboarded',
        }));
        mockUseHouseholdCarers.mockImplementation(() => ({
          data: twoCarers,
          isLoading: false,
          isError: false,
          refetch: mock(() => Promise.resolve()),
        }));
        mockUseShiftsRange.mockImplementation(() => ({
          data: twoCarerShifts,
          isLoading: false,
          isError: false,
          error: null,
        }));

        const { queryByTestId } = render(<ScheduleShiftsScreen />);

        expect(queryByTestId('schedule-week-total-note')).toBeNull();
      });
    });

    it('gives a helper the PARENT voice, not a third one — helper sees the household schedule same as a parent', () => {
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'helper',
        status: 'onboarded',
      }));
      mockUseShiftsRange.mockImplementation(() => ({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }));

      const { getByText, queryByText } = render(<ScheduleShiftsScreen />);

      expect(getByText('shifts.parentHeading')).toBeTruthy();
      expect(queryByText('shifts.nannyHeading')).toBeNull();
    });

    // Away summary sits in gutterlessHeader (week ribbon / cross-family).
    // Wide time-off range so the week overlap is date-independent.
    // react-i18next is key-echo mocked — assert keys, not English.
    it('shows the nanny away-summary key when the viewer is the carer', () => {
      useCalendarViewStore
        .getState()
        .setView('nanny', CALENDAR_VIEWS.WEEK_RIBBON);
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'nanny',
        status: 'onboarded',
      }));
      mockUseShiftsRange.mockImplementation(() => ({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }));
      mockUseHouseholdTimeOff.mockImplementation(() => ({
        data: [
          {
            id: 'timeoff-1',
            user_id: '33333333-3333-4333-8333-333333333333',
            starts_at: '2020-01-01T00:00:00.000Z',
            ends_at: '2030-01-01T00:00:00.000Z',
            all_day: true,
            message: null,
            kind: 'personal',
            status: 'confirmed',
            ical_uid: 'timeoff-1@steadily',
            sequence: 0,
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-08-01T00:00:00.000Z',
          },
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: mock(() => Promise.resolve()),
      }));

      const { getByTestId, queryByText } = render(<ScheduleShiftsScreen />);

      expect(getByTestId('schedule-away-summary').props.children).toBe(
        'shifts.awaySummaryNanny'
      );
      expect(queryByText('shifts.awaySummary')).toBeNull();

      useCalendarViewStore.getState().reset();
    });

    it('keeps the parent/helper away-summary key for a parent viewer', () => {
      useCalendarViewStore
        .getState()
        .setView('parent', CALENDAR_VIEWS.WEEK_RIBBON);
      mockUseIsOnboarded.mockImplementation(() => ({
        role: 'parent',
        status: 'onboarded',
      }));
      mockUseShiftsRange.mockImplementation(() => ({
        data: [],
        isLoading: false,
        isError: false,
        error: null,
      }));
      mockUseHouseholdTimeOff.mockImplementation(() => ({
        data: [
          {
            id: 'timeoff-1',
            user_id: '33333333-3333-4333-8333-333333333333',
            starts_at: '2020-01-01T00:00:00.000Z',
            ends_at: '2030-01-01T00:00:00.000Z',
            all_day: true,
            message: null,
            kind: 'personal',
            status: 'confirmed',
            ical_uid: 'timeoff-1@steadily',
            sequence: 0,
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-08-01T00:00:00.000Z',
          },
        ],
        isLoading: false,
        isError: false,
        error: null,
        refetch: mock(() => Promise.resolve()),
      }));

      const { getByTestId, queryByText } = render(<ScheduleShiftsScreen />);

      expect(getByTestId('schedule-away-summary').props.children).toBe(
        'shifts.awaySummary'
      );
      expect(queryByText('shifts.awaySummaryNanny')).toBeNull();

      useCalendarViewStore.getState().reset();
    });
  });

  it('REGRESSION P0-Rhythm-gate: a parent NEVER sees CrossFamilyRhythmView, even if the persisted view preference is somehow already "cross_family" (TIER0-CX-SPEC §5.2 — real household names are nanny-only)', () => {
    // Defense in depth: CalendarViewSwitcher already hides this option from
    // a parent, but the render gate must not depend on that alone — a
    // stale/corrupted persisted value must not leak a household name to a
    // parent. Simulate the worst case directly against the real, role-keyed
    // store rather than trusting the switcher to have prevented it.
    useCalendarViewStore
      .getState()
      .setView('parent', CALENDAR_VIEWS.CROSS_FAMILY);
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseActiveHousehold.mockImplementation(() => ({
      household: { id: HOUSEHOLD_ID },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID }, { id: 'other-household' }],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(queryByTestId('calendar-cross-family-view')).toBeNull();

    useCalendarViewStore.getState().reset();
  });
});

// P0 (refactored-mapping-fox plan): the Schedule tab used to show "5 times
// this week with no one booked" directly above "No shifts yet" — the same
// week disagreeing with itself, because uncovered windows sat in NEITHER
// the showEmpty nor the showContent predicate. Fixed by folding
// `canViewCover && uncoveredWeek.totalCount > 0` into showContent (and out
// of showEmpty) — see ScheduleShiftsScreen.tsx.
describe('P0: uncovered windows join the agenda, never the contradicting empty state', () => {
  it('renders the agenda with uncovered rows, not the empty state, when commitments exist but zero shifts are booked (the trust-breaker contradiction)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));
    mockUseHouseholdCommitments.mockImplementation(() => ({
      data: [makeCommitment()],
      isLoading: false,
      isError: false,
    }));

    // An ACCEPTED pattern: the summary line is the only thing telling this
    // parent about the gap, so it must show. (With no pattern — or a
    // withdrawn/ended one — the banner above already says the same thing,
    // and the summary is suppressed; see the double-telling describe below.)
    const { getByTestId, getAllByTestId, queryByTestId } = render(
      <ScheduleShiftsScreen pattern={{ status: 'accepted' } as never} />
    );

    // The two lines that used to disagree now agree: the summary is
    // visible AND the agenda (not the empty state) is what's mounted.
    expect(getByTestId('schedule-cover-week-summary')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-empty')).toBeNull();
    expect(getByTestId('schedule-shifts-list')).toBeTruthy();
    expect(getAllByTestId(/^schedule-uncovered-/).length).toBeGreaterThan(0);
  });

  it('does NOT flip a nanny into the agenda via uncovered windows — canViewCover already forces totalCount to 0 for her', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'nanny',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));
    mockUseHouseholdCommitments.mockImplementation(() => ({
      data: [makeCommitment()],
      isLoading: false,
      isError: false,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-shifts-empty')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-list')).toBeNull();
  });

  it('does not flash the contradicting empty state while commitments are still loading for a cover-viewing role', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));
    mockUseHouseholdCommitments.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
      isError: false,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('loading-indicator-container')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-empty')).toBeNull();
    expect(queryByTestId('schedule-shifts-list')).toBeNull();

    // Restore the default so later tests in this file don't inherit a
    // stuck "commitments still loading" mock.
    mockUseHouseholdCommitments.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
    }));
  });
});

// 0.2: both empty states must name their cause — a shared "No shifts yet"
// read as "you have nothing on" to a nanny when the truth was "nobody has
// done their part". Fork on viewer role x whether an accepted pattern
// exists (passed down as the `pattern` prop from the tab route).
describe('P0 0.2: empty state names its cause (viewer x pattern-accepted fork)', () => {
  it('nanny + no accepted pattern: explains the family has not set the schedule, not "no shifts"', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'nanny',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByText, queryByText } = render(
      <ScheduleShiftsScreen pattern={null} />
    );

    expect(getByText('shifts.emptyPatternPendingTitle')).toBeTruthy();
    expect(getByText('shifts.emptyPatternPendingBody')).toBeTruthy();
    expect(queryByText('shifts.empty')).toBeNull();
  });

  it('nanny + accepted pattern, week just empty: plain "no shifts this week", not the pattern-pending copy', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'nanny',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByText, queryByText } = render(
      <ScheduleShiftsScreen pattern={{ status: 'accepted' } as never} />
    );

    expect(getByText('shifts.empty')).toBeTruthy();
    expect(queryByText('shifts.emptyPatternPendingTitle')).toBeNull();
  });

  it('parent + no accepted pattern: confirms his work saved and offers Build the usual week, without claiming the week is built', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByText, queryByText } = render(
      <ScheduleShiftsScreen pattern={null} />
    );

    expect(getByText('shifts.emptyBuildParentTitle')).toBeTruthy();
    // No carer on record in this file's default mocks — the no-carer body,
    // not an interpolated-with-empty-string name.
    expect(getByText('shifts.emptyBuildParentBodyNoCarer')).toBeTruthy();
    // NO CTA here any more. It lived inside the `showEmpty` branch, which
    // goes false the moment `uncoveredWeek.totalCount > 0` — i.e. the
    // moment the parent types any care hours — so the offer to build a
    // usual week appeared once and then vanished. The pattern banner above
    // now carries that act unconditionally; a second copy of it here is the
    // same act offered twice.
    expect(queryByText('shifts.emptyBuildParentCta')).toBeNull();
    expect(queryByText('shifts.empty')).toBeNull();
  });

  it('parent + no accepted pattern + past member: no CTA (building a week is a live-parent action)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
      isPastMember: true,
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { queryByText } = render(<ScheduleShiftsScreen pattern={null} />);

    expect(queryByText('shifts.emptyBuildParentCta')).toBeNull();
  });

  it('parent + accepted pattern, week just empty: plain "no shifts this week", no CTA', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByText, queryByText } = render(
      <ScheduleShiftsScreen pattern={{ status: 'accepted' } as never} />
    );

    expect(getByText('shifts.empty')).toBeTruthy();
    expect(queryByText('shifts.emptyBuildParentTitle')).toBeNull();
    expect(queryByText('shifts.emptyBuildParentCta')).toBeNull();
  });
});

// 0.3: the empty-state illustration must not centre against the tab bar's
// height. `variant="inline"` — content-sized, not a self-centering flex:1
// box — is the fix every other illustrated empty state in this app uses.
describe('P0 0.3: empty/unavailable states use the inline EmptyState variant', () => {
  it('uses the inline (content-sized) container, not the default flex-1 self-centering one, for the empty state', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));

    const { getByTestId } = render(
      <ScheduleShiftsScreen pattern={{ status: 'accepted' } as never} />
    );

    const container = within(
      getByTestId('schedule-shifts-empty')
    ).UNSAFE_getByProps({ accessibilityRole: 'text' });
    expect(String(container.props.className)).toContain('px-4 py-8');
    expect(String(container.props.className)).not.toContain('flex-1');
  });

  it('uses the inline (content-sized) container for the unavailable state too', () => {
    const notFoundError = { response: { status: 404 } };
    mockUseShiftsRange.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: notFoundError,
      refetch: mock(() => Promise.resolve()),
    }));
    mockIsShiftsRouteUnavailable.mockImplementation(
      (error: unknown) => error === notFoundError
    );

    const { getByTestId } = render(<ScheduleShiftsScreen />);

    const container = within(
      getByTestId('schedule-shifts-unavailable')
    ).UNSAFE_getByProps({ accessibilityRole: 'text' });
    expect(String(container.props.className)).toContain('px-4 py-8');
    expect(String(container.props.className)).not.toContain('flex-1');

    mockIsShiftsRouteUnavailable.mockImplementation(() => false);
  });

  // ErrorState (unlike EmptyState) has no `inline` variant to switch to —
  // other callers depend on its self-centering flex-1 layout — so the error
  // branch reserves tab-bar space directly via useTabBarScrollPadding
  // instead (56 + 34 mocked inset + 24 = 114, per bun.setup.ts's
  // useSafeAreaInsets mock).
  it("reserves tab-bar space (paddingBottom) on the error branch, the one EmptyState variant can't fix", () => {
    const networkError = { response: { status: 500 } };
    mockUseShiftsRange.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      error: networkError,
      refetch: mock(() => Promise.resolve()),
    }));
    mockIsShiftsRouteUnavailable.mockImplementation(() => false);

    const { getByTestId } = render(<ScheduleShiftsScreen />);

    const wrapper = flattenStyle(
      getByTestId('schedule-shifts-error').props.style
    );
    expect(wrapper.paddingBottom).toBe(114);
  });
});

// The pattern banner ("you haven't set the weekly hours") and this line
// ("N windows this week have nobody booked") state different facts — the
// banner is about the household's SETUP, the summary is about which hours
// THIS week are gapped. Removing a nanny's care hours mid-week can still
// leave gaps even with an accepted pattern, and a household with no pattern
// at all is exactly the state with the MOST gaps to report — so the summary
// shows in every pattern state, never suppressed by the banner.
describe('the week-summary line reports gaps regardless of pattern state', () => {
  function renderWithPattern(pattern: unknown) {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));
    mockUseHouseholdCommitments.mockImplementation(() => ({
      data: [makeCommitment()],
      isLoading: false,
      isError: false,
    }));
    return render(<ScheduleShiftsScreen pattern={pattern as never} />);
  }

  it.each([
    ['no pattern at all', null],
    ['withdrawn', { status: 'withdrawn' }],
    ['ended', { status: 'ended' }],
    ['accepted', { status: 'accepted' }],
    ['pending', { status: 'pending' }],
    ['draft', { status: 'draft' }],
    ['declined', { status: 'declined' }],
  ])('keeps the summary line when the pattern is %s', (_label, pattern) => {
    const { getByTestId, getAllByTestId } = renderWithPattern(pattern);

    expect(getByTestId('schedule-cover-week-summary')).toBeTruthy();
    // The per-day uncovered rows in the agenda stay too — the week-level
    // headline and the day-level detail are two different things.
    expect(getAllByTestId(/^schedule-uncovered-/).length).toBeGreaterThan(0);
  });
});

// `docs/design/screens-schedule.md` §2 specifies a footer action for "Add a
// one-off shift"; the code had drifted to a `Small semibold text-primary`
// pressable sitting beside the H1 — the highest-status slot on the screen,
// holding the lesser of the two acts the parent can take here.
describe('"Add a one-off shift" is a control, not the loudest thing beside the H1', () => {
  function renderParent() {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));
    return render(<ScheduleShiftsScreen />);
  }

  it('renders it as a secondary Button', () => {
    const { getByTestId } = renderParent();

    const action = getByTestId('schedule-shifts-add-extra');
    // A bare Pressable has no `variant` — this prop only exists because the
    // action is a real Button now.
    expect(action.props.variant).toBe('secondary');
  });

  it('no longer sits in the heading row beside the H1', () => {
    const { getByTestId } = renderParent();

    // The heading row is `flex-row items-center justify-between gap-2`,
    // wrapping the H1 — the one container the one-off action must not be
    // inside any more.
    let node = getByTestId('schedule-shifts-add-extra').parent;
    while (node) {
      expect(String(node.props.className ?? '')).not.toContain(
        'items-center justify-between'
      );
      node = node.parent;
    }
  });
});

// Pattern A NAVIGATION-TIME (`docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §A):
// the Schedule TAB can only ever show one household, so a push landing here
// with `householdId` on the link must move the switcher (announced) rather
// than silently open the wrong family's week.
describe('Pattern A: a deep link carrying householdId', () => {
  function mockHouseholds(households: unknown[]) {
    const setActiveHouseholdId = mock();
    mockUseActiveHousehold.mockImplementation(() => ({
      household: { id: HOUSEHOLD_ID, week_starts_on: 1 },
      householdId: HOUSEHOLD_ID,
      households,
      pastHouseholds: [],
      setActiveHouseholdId,
      isLoading: false,
      isError: false,
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));
    return setActiveHouseholdId;
  }

  it('switches the active household and says so, when the link names a DIFFERENT household she belongs to', () => {
    const setActiveHouseholdId = mockHouseholds([
      { id: HOUSEHOLD_ID, name: 'The Active Family' },
      { id: OTHER_HOUSEHOLD_ID, name: 'The Other Family' },
    ]);
    mockSearchParams = { householdId: OTHER_HOUSEHOLD_ID };

    const { queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(setActiveHouseholdId).toHaveBeenCalledWith(OTHER_HOUSEHOLD_ID);
    expect(mockShowInfoToast).toHaveBeenCalled();
    expect(queryByTestId('schedule-deep-link-not-member')).toBeNull();
  });

  it('renders the not-a-member ErrorState and switches NOTHING when the link names a household she is not in', () => {
    const setActiveHouseholdId = mockHouseholds([
      { id: HOUSEHOLD_ID, name: 'The Active Family' },
    ]);
    mockSearchParams = { householdId: OTHER_HOUSEHOLD_ID };

    const { getByTestId, queryByTestId } = render(<ScheduleShiftsScreen />);

    expect(getByTestId('schedule-deep-link-not-member')).toBeTruthy();
    expect(setActiveHouseholdId).not.toHaveBeenCalled();
    expect(mockShowInfoToast).not.toHaveBeenCalled();
    // Short-circuits the normal branches — no empty state underneath it.
    expect(queryByTestId('schedule-shifts-empty')).toBeNull();
    expect(queryByTestId('schedule-shifts-list')).toBeNull();
  });
});

// Pattern B (`docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §B): `commitments` is
// an INPUT to `computeUncoveredWeek`, read as `?? []`. When that read fails
// the uncovered windows silently become zero, `hasUncoveredForViewer` goes
// false and `showEmpty` goes true — so a failed read rendered as "no shifts
// yet, you're set up" when the truth was "we do not know".
describe('Pattern B: a failed cover input never renders as "you are set up"', () => {
  it('withholds the empty state and offers a retry when the commitments read fails', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'parent',
      status: 'onboarded',
    }));
    mockUseActiveHousehold.mockImplementation(() => ({
      household: { id: HOUSEHOLD_ID, week_starts_on: 1 },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID }],
      pastHouseholds: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    }));
    mockUseShiftsRange.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    }));
    const refetch = mock(() => Promise.resolve());
    mockUseHouseholdCommitments.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    }));

    const { getByTestId, queryByTestId, queryByText } = render(
      <ScheduleShiftsScreen pattern={{ status: 'accepted' } as never} />
    );

    expect(queryByTestId('schedule-shifts-empty')).toBeNull();
    expect(queryByText('shifts.empty')).toBeNull();
    expect(getByTestId('schedule-cover-retry')).toBeTruthy();

    fireEvent.press(getByTestId('schedule-cover-retry-button'));
    expect(refetch).toHaveBeenCalled();

    // Restore the default so later files/tests don't inherit a stuck error.
    mockUseHouseholdCommitments.mockImplementation(() => ({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mock(() => Promise.resolve()),
    }));
  });
});
