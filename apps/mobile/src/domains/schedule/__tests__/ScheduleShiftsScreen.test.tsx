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
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
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

mock.module('@/src/hooks/queries/useHouseholdTimeOff', () => ({
  useHouseholdTimeOff: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

// AgendaView resolves carer names off this — an empty household keeps its
// existing single-carer-shaped assertions below unaffected (showCarerNames
// only flips true at 2+ nanny/helper members).
mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: [], isLoading: false }),
}));

mock.module('expo-router', () => ({
  useRouter: () => ({ push: mock(), back: mock() }),
  useLocalSearchParams: () => ({}),
  router: { push: mock(), replace: mock(), back: mock() },
}));

mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
  useHouseholdCommitments: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
  useHouseholdClosures: () => ({ data: [], isLoading: false, isError: false }),
}));

mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: () => ({ data: [], isLoading: false }),
}));

mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: () => ({ data: [], isLoading: false }),
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
  mockUseActiveHousehold = mock(() => ({
    household: { id: HOUSEHOLD_ID, week_starts_on: 1 },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID }],
    setActiveHouseholdId: mock(),
    isLoading: false,
  }));
  mockIsShiftsRouteUnavailable = mock(() => false);
  mockUseIsOnboarded = mock(() => ({ role: 'parent', status: 'onboarded' }));

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
    // daylight-v2 §3: a confirmed row is a settled fact — no StatusPill.
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

  it('P1: "Add a one-off shift" renders at Small/14/600, not Button-sm 16 (reads as heavy as the H1)', () => {
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

    const { getByText } = render(<ScheduleShiftsScreen />);

    const style = flattenStyle(getByText('shifts.addExtra').props.style);
    expect(style.fontSize).toBe(14);
    expect(style.fontWeight).toBe('600');
  });

  describe('S12: role-forked H1/subtitle (same screen, two voices)', () => {
    it('shows the nanny voice — "This week" / shifts-with-family — for role nanny', () => {
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
      expect(getByText('shifts.nannySubtitle')).toBeTruthy();
      expect(queryByText('shifts.parentHeading')).toBeNull();
      expect(queryByText('shifts.parentSubtitle')).toBeNull();
    });

    it('shows the parent voice — "Schedule" / weekly-pattern — for role parent', () => {
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
      expect(getByText('shifts.parentSubtitle')).toBeTruthy();
      expect(queryByText('shifts.nannyHeading')).toBeNull();
      expect(queryByText('shifts.nannySubtitle')).toBeNull();
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
      expect(getByText('shifts.parentSubtitle')).toBeTruthy();
      expect(queryByText('shifts.nannyHeading')).toBeNull();
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
