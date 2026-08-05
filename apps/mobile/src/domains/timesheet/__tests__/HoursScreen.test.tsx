/**
 * @module domains/timesheet/__tests__/HoursScreen.test
 *
 * D15 regression guard. `WeekTotal.test.tsx` hands `onPreviousWeek`/
 * `onNextWeek` mocks directly to `WeekTotal` and passes — that only proves
 * the control works in isolation, not that anything in the app calls it. A
 * previous pass wired the nav into `WeekTotal` and stopped there: neither
 * `HoursScreen` nor either role view ever passed the callbacks down, so on
 * device the Hours screen was permanently stuck on the current week for
 * both roles. This file renders the ACTUAL `HoursScreen` (both roles) so a
 * green run means the feature is wired end-to-end, not unit-tested in a
 * vacuum. `useIsOnboarded` / `useActiveHousehold` / `useWeekTimeEntries` /
 * `useWeekTimesheet` / the approve+query mutations are mocked via
 * `mock.module()` in `beforeAll`, before the dynamic import, per
 * docs/09-TESTING.md's service-test boilerplate.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { addWeeks, getWeekStartISO } from '../utils/week';

// LoadingIndicator's require('@/assets/splash.png') breaks bundling under
// bun:test — mock it out to a plain marker View (same as
// ScheduleShiftsScreen.test.tsx / loading-indicator.test.tsx).
mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

// QueryNoteSheet renders BottomSheetBase, which pulls in
// `useSheetDragToDismiss` -> `react-native-gesture-handler`'s `Gesture.Pan()`
// chain — the global preload's Gesture mock only stubs `.onBegin`, so any
// mount of a real BottomSheetBase crashes under bun:test regardless of this
// screen's D15 nav (no test in the repo currently renders BottomSheetBase
// for that reason). Stubbed to a marker View so this file can still assert
// the ParentWeekView / hours-approve / hours-query gating for real, rather
// than dropping to source inspection for the whole parent role.
mock.module('@/src/domains/timesheet/components/QueryNoteSheet', () => {
  const React = require('react');
  return {
    QueryNoteSheet: () =>
      React.createElement('View', { testID: 'query-note-sheet-stub' }),
  };
});

mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({
    data: [
      {
        user_id: 'carer-1',
        role: 'nanny',
        display_name_override: 'Alex',
        status: 'active',
      },
    ],
    isLoading: false,
  }),
}));

// Phase 4 (additive): both role views now call real `useQuery`/`useMutation`
// expense hooks unconditionally in their footer — mocked for the same
// "a real hook needs a QueryClientProvider this screen test deliberately
// doesn't stand up" reason as `useApproveTimesheet`/`useQueryTimesheet`
// above.
mock.module('@/src/hooks/queries/useWeekExpenses', () => ({
  useWeekExpenses: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/usePendingExpenses', () => ({
  usePendingExpenses: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
  useCurrentPayArrangement: () => ({ data: null, isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useCreateExpense', () => ({
  useCreateExpense: () => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }),
}));
mock.module('@/src/hooks/mutations/useUpdateExpense', () => ({
  useUpdateExpense: () => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }),
}));
mock.module('@/src/hooks/mutations/useWithdrawExpense', () => ({
  useWithdrawExpense: () => ({
    mutateAsync: mock(() => Promise.resolve()),
    isPending: false,
  }),
}));
mock.module('@/src/hooks/mutations/useReviewExpense', () => ({
  useReviewExpense: () => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }),
}));

// TimeEntryDayRow now hosts a flagged-entry AlertDialog (Wave 4 CX).
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
    }) =>
      React.createElement(
        Ctx.Provider,
        {
          value: {
            open: open ?? false,
            setOpen: (next: boolean) => onOpenChange?.(next),
          },
        },
        children
      ),
    Trigger: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Pressable', props, children),
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: () => null,
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
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Pressable', props, children),
    Action: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Pressable', props, children),
    useRootContext: () => React.useContext(Ctx),
  };
});

const HOUSEHOLD_ID = '5d4b0b70-edd9-4218-b7df-a28d234f7e06';
// Matches the seeded `submitted` timesheet the app should be able to reach
// once nav actually works: id 4359148e-d5ee-4515-9fca-3396b29ee48d,
// week_start 2026-01-05, household 5d4b0b70-edd9-4218-b7df-a28d234f7e06.
const TIMEZONE = 'UTC';

let HoursScreen: typeof import('../components/HoursScreen').HoursScreen;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseWeekTimeEntries: ReturnType<typeof mock>;
let mockUseWeekTimesheet: ReturnType<typeof mock>;
let mockUseApproveTimesheet: ReturnType<typeof mock>;
let mockUseQueryTimesheet: ReturnType<typeof mock>;
let mockUseReopenTimesheet: ReturnType<typeof mock>;
let mockUseUpdateTimeEntry: ReturnType<typeof mock>;
let mockUseLocalSearchParams: ReturnType<typeof mock>;
let mockSetParams: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseActiveHousehold = mock(() => ({
    household: { id: HOUSEHOLD_ID, timezone: TIMEZONE },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID, timezone: TIMEZONE }],
    setActiveHouseholdId: mock(),
    isLoading: false,
  }));
  mockUseWeekTimeEntries = mock(() => ({ data: [], isLoading: false }));
  mockUseWeekTimesheet = mock(() => ({ data: null, isLoading: false }));
  mockUseApproveTimesheet = mock(() => ({
    mutateAsync: mock(() => Promise.resolve()),
    isPending: false,
  }));
  mockUseQueryTimesheet = mock(() => ({
    mutateAsync: mock(() => Promise.resolve()),
    isPending: false,
  }));
  mockUseReopenTimesheet = mock(() => ({
    mutateAsync: mock(() => Promise.resolve()),
    isPending: false,
  }));
  mockUseUpdateTimeEntry = mock(() => ({
    mutateAsync: mock(async () => ({})),
    isPending: false,
  }));
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));
  // Mutable deep-link params — `hoursHref` emits weekStart; the screen must
  // land on that week, not merely receive the string on the URL.
  mockUseLocalSearchParams = mock(() => ({}));
  mockSetParams = mock(() => {});

  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockUseWeekTimeEntries,
  }));
  mock.module('@/src/hooks/queries/useWeekTimesheet', () => ({
    useWeekTimesheet: mockUseWeekTimesheet,
  }));
  mock.module('@/src/hooks/mutations/useApproveTimesheet', () => ({
    useApproveTimesheet: mockUseApproveTimesheet,
  }));
  mock.module('@/src/hooks/mutations/useQueryTimesheet', () => ({
    useQueryTimesheet: mockUseQueryTimesheet,
  }));
  // The approved week's undo — same reason as the two above.
  mock.module('@/src/hooks/mutations/useReopenTimesheet', () => ({
    useReopenTimesheet: mockUseReopenTimesheet,
  }));
  // The nanny week's correction path (Daylight UX P0-2) — mocked for the
  // same reason as the two above: a real `useMutation` needs a
  // QueryClientProvider this screen test deliberately doesn't stand up.
  mock.module('@/src/hooks/mutations/useUpdateTimeEntry', () => ({
    useUpdateTimeEntry: mockUseUpdateTimeEntry,
  }));
  mock.module('expo-router', () => {
    const React = require('react');
    // Stable router identity — a fresh object per useRouter() call would
    // re-fire the weekStart consume effect on every render via its deps.
    const routerApi = {
      push: mock(),
      replace: mock(),
      back: mock(),
      navigate: mock(),
      setParams: mockSetParams,
    };
    return {
      useRouter: mock(() => routerApi),
      useLocalSearchParams: mockUseLocalSearchParams,
      useSegments: mock(() => []),
      usePathname: mock(() => ''),
      // Real focus/blur lifecycle so leave-tab cleanup (reset to current week)
      // is exercised under bun:test, not a no-op stub.
      useFocusEffect: (effect: () => undefined | (() => void)) => {
        React.useEffect(() => {
          const cleanup = effect();
          return typeof cleanup === 'function' ? cleanup : undefined;
        }, [effect]);
      },
      router: routerApi,
      Link: 'Link',
      Redirect: 'Redirect',
      Stack: { Screen: 'StackScreen' },
      Tabs: { Screen: 'TabsScreen' },
    };
  });

  const mod = await import('../components/HoursScreen');
  HoursScreen = mod.HoursScreen;
});

beforeEach(() => {
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseLocalSearchParams.mockImplementation(() => ({}));
  mockUseWeekTimeEntries.mockClear();
  mockUseWeekTimesheet.mockClear();
  mockSetParams.mockClear();
});

describe('HoursScreen — nanny with multiple households (Wave B)', () => {
  it('uses the ACTIVE household, not onboarding.householdId, when the two differ', () => {
    const ONBOARDING_HOUSEHOLD_ID = 'onboarding-household-should-not-be-used';
    const ACTIVE_HOUSEHOLD_ID = 'active-household-should-be-used';
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'nanny',
      householdId: ONBOARDING_HOUSEHOLD_ID,
    }));
    mockUseActiveHousehold.mockImplementation(() => ({
      household: { id: ACTIVE_HOUSEHOLD_ID, timezone: TIMEZONE },
      householdId: ACTIVE_HOUSEHOLD_ID,
      households: [
        { id: ONBOARDING_HOUSEHOLD_ID, timezone: TIMEZONE },
        { id: ACTIVE_HOUSEHOLD_ID, timezone: TIMEZONE },
      ],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));

    render(<HoursScreen />);

    const lastCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(lastCall?.[0]).toBe(ACTIVE_HOUSEHOLD_ID);

    // Reset back to the single-household default for subsequent tests.
    mockUseActiveHousehold.mockImplementation(() => ({
      household: { id: HOUSEHOLD_ID, timezone: TIMEZONE },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID, timezone: TIMEZONE }],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));
  });
});

describe('HoursScreen — deep-link weekStart (Gap 3)', () => {
  // The bug: `hoursHref` for timesheet_queried emits `?weekStart=…` but
  // HoursScreen ignored search params and always opened weekOffset=0. Assert
  // the DESTINATION week (query arg / displayed weekStart), not the href shape.
  it('lands on the deep-linked weekStart three weeks back, not the current week', () => {
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE);
    const threeWeeksBack = addWeeks(currentWeekStart, -3);
    mockUseLocalSearchParams.mockImplementation(() => ({
      householdId: HOUSEHOLD_ID,
      weekStart: threeWeeksBack,
      timesheetId: 'ts-queried-1',
    }));

    const { getByTestId } = render(<HoursScreen />);

    const lastCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(lastCall?.[1]).toBe(threeWeeksBack);
    expect(lastCall?.[1]).not.toBe(currentWeekStart);
    // Next must be enabled — we're not on the current week anymore.
    expect(getByTestId('hours-week-next').props.disabled).toBe(false);
  });

  it('defaults to the current week when weekStart is absent from search params', () => {
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE);
    mockUseLocalSearchParams.mockImplementation(() => ({}));

    render(<HoursScreen />);

    const lastCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(lastCall?.[1]).toBe(currentWeekStart);
  });

  // Wave 2B: weekStart must be one-shot. The Hours tab stays mounted across
  // blur (`unmountOnBlur` is off), so a sticky search param would reopen the
  // deep-linked week on every later visit. Consume → clear → leave → return
  // without the param must land on the current week.
  it('treats weekStart as one-shot — clear + remount without param shows current week', () => {
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE);
    const threeWeeksBack = addWeeks(currentWeekStart, -3);
    mockUseLocalSearchParams.mockImplementation(() => ({
      weekStart: threeWeeksBack,
    }));

    const { unmount } = render(<HoursScreen />);

    const deepLinkedCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(deepLinkedCall?.[1]).toBe(threeWeeksBack);
    expect(mockSetParams).toHaveBeenCalledWith(
      expect.objectContaining({ weekStart: undefined })
    );

    unmount();
    mockUseLocalSearchParams.mockImplementation(() => ({}));
    mockUseWeekTimeEntries.mockClear();

    render(<HoursScreen />);

    const returnCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(returnCall?.[1]).toBe(currentWeekStart);
  });

  it('keeps prev/next paging after weekStart is consumed and cleared', () => {
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE);
    const threeWeeksBack = addWeeks(currentWeekStart, -3);
    const fourWeeksBack = addWeeks(currentWeekStart, -4);
    mockUseLocalSearchParams.mockImplementation(() => ({
      weekStart: threeWeeksBack,
    }));

    const { getByTestId, rerender } = render(<HoursScreen />);
    // Simulate the router honouring setParams — param gone, consumed offset kept.
    mockUseLocalSearchParams.mockImplementation(() => ({}));
    rerender(<HoursScreen />);
    mockUseWeekTimeEntries.mockClear();

    fireEvent.press(getByTestId('hours-week-prev'));

    const lastCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(lastCall?.[1]).toBe(fourWeeksBack);
  });
});

describe('HoursScreen — nanny', () => {
  it('renders the previous/next week controls (dead until HoursScreen wires them)', () => {
    const { getByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-week-prev')).toBeTruthy();
    expect(getByTestId('hours-week-next')).toBeTruthy();
  });

  it('disables hours-week-next while showing the current week', () => {
    const { getByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-week-next').props.disabled).toBe(true);
    expect(
      getByTestId('hours-week-next').props.accessibilityState?.disabled
    ).toBe(true);
  });

  it('pressing hours-week-prev requests the PRIOR week from the query layer, and re-enables next', () => {
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE);
    const priorWeekStart = addWeeks(currentWeekStart, -1);

    const { getByTestId } = render(<HoursScreen />);
    mockUseWeekTimeEntries.mockClear();

    fireEvent.press(getByTestId('hours-week-prev'));

    // Assert on the actual query argument, not just a label — the failure
    // mode being guarded against is "control renders, nothing happens".
    const lastCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(lastCall?.[1]).toBe(priorWeekStart);
    expect(lastCall?.[1]).not.toBe(currentWeekStart);

    expect(getByTestId('hours-week-next').props.disabled).toBe(false);
  });

  it('pressing hours-week-prev twice then hours-week-next once lands two weeks back, not one', () => {
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE);
    const twoWeeksBack = addWeeks(currentWeekStart, -2);

    const { getByTestId } = render(<HoursScreen />);

    fireEvent.press(getByTestId('hours-week-prev'));
    fireEvent.press(getByTestId('hours-week-prev'));
    fireEvent.press(getByTestId('hours-week-prev'));
    mockUseWeekTimeEntries.mockClear();
    fireEvent.press(getByTestId('hours-week-next'));

    const lastCall = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(lastCall?.[1]).toBe(twoWeeksBack);
  });

  it('cannot navigate past the current week — hours-week-next is a no-op once disabled', () => {
    const { getByTestId } = render(<HoursScreen />);
    expect(getByTestId('hours-week-next').props.disabled).toBe(true);
    mockUseWeekTimeEntries.mockClear();

    fireEvent.press(getByTestId('hours-week-next'));

    // A disabled control firing `press` must not trigger a re-render with a
    // new (future) week argument — RTL/RN don't invoke `onPress` on a
    // disabled Pressable, so no new query call should land at all.
    expect(mockUseWeekTimeEntries.mock.calls.length).toBe(0);
    expect(getByTestId('hours-week-next').props.disabled).toBe(true);
  });

  // Neither API endpoint bounds how far back `week_start` can go — the
  // screen has to cap it itself (`MAX_WEEKS_BACK` in HoursScreen.tsx) so
  // nobody can page back indefinitely into years before the household
  // existed. 104 presses is deliberately one more than the 104-week cap.
  it('cannot page back past the bounded history window — hours-week-prev disables and stops moving', () => {
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE);
    const oldestReachableWeek = addWeeks(currentWeekStart, -104);

    const { getByTestId } = render(<HoursScreen />);
    for (let i = 0; i < 104; i++) {
      fireEvent.press(getByTestId('hours-week-prev'));
    }

    expect(getByTestId('hours-week-prev').props.disabled).toBe(true);
    const lastCallAtCap = mockUseWeekTimeEntries.mock.calls.at(-1) as
      | [string, string]
      | undefined;
    expect(lastCallAtCap?.[1]).toBe(oldestReachableWeek);

    // One more press past the cap must be a genuine no-op, same as the
    // future-week case above.
    mockUseWeekTimeEntries.mockClear();
    fireEvent.press(getByTestId('hours-week-prev'));
    expect(mockUseWeekTimeEntries.mock.calls.length).toBe(0);
  });
});

describe('HoursScreen — parent, historical weeks stay non-actionable', () => {
  beforeEach(() => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'parent',
      householdId: HOUSEHOLD_ID,
    }));
  });

  it('renders nav controls for the parent role too', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: null,
      isLoading: false,
    }));

    const { getByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-week-prev')).toBeTruthy();
    expect(getByTestId('hours-week-next')).toBeTruthy();
  });

  it('an already-approved past week renders approved and non-actionable — no re-approval of history', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: {
        id: '4359148e-d5ee-4515-9fca-3396b29ee48d',
        status: 'approved',
        query_note: null,
      },
      isLoading: false,
    }));

    const { getByTestId } = render(<HoursScreen />);
    fireEvent.press(getByTestId('hours-week-prev'));

    const approveButton = getByTestId('hours-approve-button');
    const queryButton = getByTestId('hours-query-button');
    expect(approveButton.props.disabled).toBe(true);
    expect(queryButton.props.disabled).toBe(true);
  });

  it('a submitted past week stays actionable (approve/query still work on history that needs it)', () => {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: {
        id: '4359148e-d5ee-4515-9fca-3396b29ee48d',
        status: 'submitted',
        query_note: null,
      },
      isLoading: false,
    }));

    const { getByTestId } = render(<HoursScreen />);
    fireEvent.press(getByTestId('hours-week-prev'));

    expect(getByTestId('hours-approve-button').props.disabled).toBe(false);
    expect(getByTestId('hours-query-button').props.disabled).toBe(false);
  });
});
