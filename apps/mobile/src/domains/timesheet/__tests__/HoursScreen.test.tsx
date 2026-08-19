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
import {
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Image } from 'react-native';
import { useAuthStore } from '@/src/store/auth';
import {
  addWeeks,
  formatWeekRangeLabel,
  getWeekDates,
  getWeekStartISO,
} from '../utils/week';

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

// Same reason as QueryNoteSheet above — the breakdown sheet renders a real
// BottomSheetBase, which this file cannot mount. Stubbed to a marker so the
// payment → hours → breakdown route can be asserted end-to-end here rather
// than only inside the two week-view integration suites.
mock.module('@/src/domains/timesheet/components/EarningsBreakdownSheet', () => {
  const React = require('react');
  return {
    EarningsBreakdownSheet: ({ visible }: { visible: boolean }) =>
      visible
        ? React.createElement('View', { testID: 'earnings-breakdown-stub' })
        : null,
  };
});

// Pattern A (navigation-time): the deep-link household switch announces
// itself with an info toast, and `HouseholdSwitcher` renders a real
// `BottomSheetBase` this file cannot mount (same reason as QueryNoteSheet
// above) — both stubbed so the switch itself can be asserted.
const mockShowInfoToast = mock((_message: string) => {});
mock.module('@/src/lib/toast', () => ({
  showInfoToast: mockShowInfoToast,
  showSuccessToast: mock(() => {}),
  showErrorToast: mock(() => {}),
  showWarningToast: mock(() => {}),
}));
mock.module('@/src/domains/household/components/HouseholdSwitcher', () => {
  const React = require('react');
  return {
    HouseholdSwitcher: () =>
      React.createElement('View', { testID: 'household-switcher-stub' }),
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

// Settlement (067): both role views call the real payments query/mutation
// unconditionally on an approved week — mocked for the same "a real hook
// needs a QueryClientProvider this screen test deliberately doesn't stand
// up" reason as every hook above.
mock.module('@/src/hooks/queries/usePayments', () => ({
  usePayments: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useRecordPayment', () => ({
  useRecordPayment: () => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }),
  overPaymentMetadata: () => null,
}));
// The correction append (D-20). The parent view builds the mutation
// unconditionally — the sheet only opens from `PaymentDetailSheet` — so it is
// mocked for the same reason as its sibling above.
mock.module('@/src/hooks/mutations/useCorrectPayment', () => ({
  useCorrectPayment: () => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }),
  correctionRefusalMetadata: () => null,
}));

// Reimbursement settlements (D-14): the parent view reads them
// unconditionally to state whether she has been paid back, same "needs a
// QueryClientProvider this screen test deliberately doesn't stand up"
// reason as the payments hooks above. No settlement = the card's
// unsettled state words, which change none of this screen's assertions.
mock.module('@/src/hooks/queries/useReimbursementSettlements', () => ({
  useReimbursementSettlements: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useMarkReimbursed', () => ({
  useMarkReimbursed: () => ({
    mutateAsync: mock(() => Promise.resolve({})),
    reset: mock(() => {}),
    isPending: false,
    error: null,
  }),
}));

// The week thread (3-T1): both role views read it unconditionally, for the
// same reason as the payments hooks above. An empty thread is the ~50 clean
// weeks a year, and `WeekQueryThread` renders nothing for it — so none of
// this screen's assertions change shape.
mock.module('@/src/hooks/queries/useTimesheetThread', () => ({
  useTimesheetThread: () => ({ data: { messages: [] }, isLoading: false }),
}));
mock.module('@/src/hooks/queries/useShiftsRange', () => ({
  useShiftsRange: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/hooks/mutations/useAddTimesheetThreadMessage', () => ({
  useAddTimesheetThreadMessage: () => ({
    mutate: mock(() => {}),
    mutateAsync: mock(() => Promise.resolve({ messages: [] })),
    isPending: false,
    error: null,
  }),
}));
mock.module('@/src/hooks/mutations/useWithdrawTimesheetQuery', () => ({
  useWithdrawTimesheetQuery: () => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }),
}));
// U2: ParentWeekView stamps parent_viewed_at on a submitted week. Unmocked
// it reaches the real useMutation and every HoursScreen case dies on
// "No QueryClient" — same reason as useWithdrawTimesheetQuery above.
mock.module('@/src/hooks/mutations/useMarkTimesheetViewed', () => ({
  useMarkTimesheetViewed: () => ({
    mutate: mock(() => {}),
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
let mockUseVoidTimeEntry: ReturnType<typeof mock>;
let mockUseLocalSearchParams: ReturnType<typeof mock>;
let mockSetParams: ReturnType<typeof mock>;
// Stable across renders — the per-render `mock()` in the default household
// implementation below cannot record a call made on an earlier render.
const mockSetActiveHouseholdId = mock((_id: string) => {});

beforeAll(async () => {
  mockUseActiveHousehold = mock(() => ({
    household: { id: HOUSEHOLD_ID, timezone: TIMEZONE, week_starts_on: 1 },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID, timezone: TIMEZONE, week_starts_on: 1 }],
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
  // NannyWeekView calls this for the void action (069); unmocked it reaches
  // the real useMutation and every HoursScreen case dies on "No QueryClient".
  mockUseVoidTimeEntry = mock(() => ({
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
    // Named export ParentWeekView imports too — omitting it makes the whole
    // module fail to link, not just this hook.
    isPaidWeekReopenRefusal: () => false,
  }));
  // The nanny week's correction path (Daylight UX P0-2) — mocked for the
  // same reason as the two above: a real `useMutation` needs a
  // QueryClientProvider this screen test deliberately doesn't stand up.
  mock.module('@/src/hooks/mutations/useUpdateTimeEntry', () => ({
    useUpdateTimeEntry: mockUseUpdateTimeEntry,
  }));
  mock.module('@/src/hooks/mutations/useVoidTimeEntry', () => ({
    useVoidTimeEntry: mockUseVoidTimeEntry,
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
  // Reset here too, not only inside the cases that override it — the loading
  // branch below returns a household-less `isLoading: true`, and leaking that
  // into the next test would blank the week views it is asserting on.
  mockUseActiveHousehold.mockImplementation(() => ({
    household: { id: HOUSEHOLD_ID, timezone: TIMEZONE, week_starts_on: 1 },
    householdId: HOUSEHOLD_ID,
    households: [{ id: HOUSEHOLD_ID, timezone: TIMEZONE, week_starts_on: 1 }],
    setActiveHouseholdId: mock(),
    isLoading: false,
  }));
  mockUseWeekTimesheet.mockImplementation(() => ({
    data: null,
    isLoading: false,
  }));
  mockUseLocalSearchParams.mockImplementation(() => ({}));
  mockSetActiveHouseholdId.mockClear();
  mockShowInfoToast.mockClear();
  mockUseWeekTimeEntries.mockClear();
  mockUseWeekTimesheet.mockClear();
  mockSetParams.mockClear();
});

// Daylight P1: the title read as a subtitle next to Today/Shifts' H1s, and
// the list scrolled under it unmasked (screenshot 11) because the header
// row had no ground of its own.
describe('HoursScreen — title scale (Daylight P1)', () => {
  it('renders the title as an H1 (aria-level 1), not the smaller H4', () => {
    const { getByTestId } = render(<HoursScreen />);
    expect(getByTestId('hours-title').props['aria-level']).toBe('1');
  });

  // Daylight v2 reverses the original fix rather than dropping it: the fixed
  // opaque `hours-title-row` is GONE, because the statement is now meant to
  // sit on the brand wash. The H1 moved into each week view's list header
  // (`HoursHeroBand`) so it scrolls WITH the content instead of being a band
  // the content slides under (screens-hours.md §2).
  it('renders the title inside the scrollable hero band, not a fixed opaque header row', () => {
    const { getByTestId, queryByTestId } = render(<HoursScreen />);

    expect(queryByTestId('hours-title-row')).toBeNull();
    expect(getByTestId('screen-wash')).toBeTruthy();
    expect(
      within(getByTestId('hours-hero-band')).getByTestId('hours-title')
    ).toBeTruthy();
  });
});

// The loading state is the reason the hero band exists. The `LoadingIndicator`
// it replaces returned a full-screen spinner from the same branch, blanking
// the title and the week label on every household/role resolution — both are
// derived locally from the household timezone and never needed a request.
describe('HoursScreen — loading week keeps its title and week label', () => {
  const loadingHousehold = () => ({
    household: null,
    householdId: null,
    households: [],
    setActiveHouseholdId: mock(),
    isLoading: true,
  });

  function expectStatementChrome(
    getByTestId: ReturnType<typeof render>['getByTestId'],
    queryByTestId: ReturnType<typeof render>['queryByTestId']
  ) {
    const currentWeekLabel = formatWeekRangeLabel(
      getWeekDates(getWeekStartISO(new Date(), TIMEZONE, 1))
    );
    // The loading marker survives the rewrite — Maestro keys off it.
    expect(getByTestId('hours-loading')).toBeTruthy();
    expect(getByTestId('hours-title')).toBeTruthy();
    // Not merely present: the REAL week label, not an empty placeholder.
    expect(getByTestId('hours-week-label').props.children).toBe(
      currentWeekLabel
    );
    // Only the figure is a skeleton, and it is never a fabricated `0m`.
    expect(getByTestId('hours-total-skeleton')).toBeTruthy();
    expect(queryByTestId('hours-total')).toBeNull();
    expect(queryByTestId('hours-empty-week')).toBeNull();
  }

  it('shows the week skeleton, not a blank screen, while the household loads', () => {
    mockUseActiveHousehold.mockImplementation(loadingHousehold);

    const { getByTestId, queryByTestId } = render(<HoursScreen />);

    expectStatementChrome(getByTestId, queryByTestId);
    expect(getByTestId('hours-day-skeleton-0')).toBeTruthy();
  });

  it('does the same while the ROLE is still resolving', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'loading',
      role: null,
      householdId: null,
    }));

    const { getByTestId, queryByTestId } = render(<HoursScreen />);

    expectStatementChrome(getByTestId, queryByTestId);
  });
});

// D-36 §S6 item 4: the draft is HERS — nothing can insert a time entry into
// a draft household (093), so this is a true empty state, never "the family
// is still setting up" (there is no family yet).
describe('HoursScreen — draft household empty state (D-36)', () => {
  it('shows the draft empty state instead of the week views', () => {
    mockUseActiveHousehold.mockImplementation(() => ({
      household: {
        id: HOUSEHOLD_ID,
        timezone: TIMEZONE,
        week_starts_on: 1,
        state: 'draft',
      },
      householdId: HOUSEHOLD_ID,
      households: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-draft-empty')).toBeTruthy();
    expect(queryByTestId('hours-loading')).toBeNull();
    expect(queryByTestId('hours-total')).toBeNull();
  });

  it('renders illustration, title, body, and draft action; action routes to Today home', () => {
    mockUseActiveHousehold.mockImplementation(() => ({
      household: {
        id: HOUSEHOLD_ID,
        timezone: TIMEZONE,
        week_starts_on: 1,
        state: 'draft',
      },
      householdId: HOUSEHOLD_ID,
      households: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));

    const { getByTestId, getByLabelText, UNSAFE_getAllByType } = render(
      <HoursScreen />
    );
    const routerApi = require('expo-router').router;

    const draftEmpty = getByTestId('hours-draft-empty');
    expect(UNSAFE_getAllByType(Image).length).toBeGreaterThan(0);
    expect(within(draftEmpty).getByText('draftEmpty.title')).toBeTruthy();
    expect(within(draftEmpty).getByText('draftEmpty.description')).toBeTruthy();
    expect(getByLabelText('draftEmpty.actionLabel')).toBeTruthy();

    fireEvent.press(getByLabelText('draftEmpty.actionLabel'));
    expect(routerApi.push).toHaveBeenCalledWith('/(private)/(tabs)/home');
  });
});

describe('HoursScreen — no-household empty state (§A)', () => {
  it('keeps the H1 and renders illustration, title, body, join action; action routes to join-household', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'not-onboarded',
      role: null,
      householdId: null,
    }));
    mockUseActiveHousehold.mockImplementation(() => ({
      household: null,
      householdId: null,
      households: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
    }));

    const { getByTestId, getByText, getByLabelText, UNSAFE_getAllByType } =
      render(<HoursScreen />);
    const routerApi = require('expo-router').router;

    expect(getByText('title').props['aria-level']).toBe('1');
    const noHouseholdEmpty = getByTestId('hours-no-household-empty');
    expect(UNSAFE_getAllByType(Image).length).toBeGreaterThan(0);
    expect(
      within(noHouseholdEmpty).getByText('noHousehold.title')
    ).toBeTruthy();
    expect(
      within(noHouseholdEmpty).getByText('noHousehold.description')
    ).toBeTruthy();
    expect(getByLabelText('noHousehold.actionLabel')).toBeTruthy();

    fireEvent.press(getByLabelText('noHousehold.actionLabel'));
    expect(routerApi.push).toHaveBeenCalledWith(
      '/(private)/settings/join-household'
    );
  });
});

// `isPastMember` is now a prop in its own right, distinct from `readOnly` —
// the removed member is TOLD her record stays rather than silently losing
// every button. A view that only received `readOnly` could not tell the two
// apart, so the last case here is the discriminating one.
describe('HoursScreen — forwards isPastMember to the week view', () => {
  const submittedWeek = () => ({
    data: [
      {
        id: '4359148e-d5ee-4515-9fca-3396b29ee48d',
        carer_id: null,
        carer_display_name: 'Amara',
        status: 'submitted',
        query_note: null,
      },
    ],
    isLoading: false,
  });

  it('renders the past-member note for a removed nanny', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'nanny',
      householdId: HOUSEHOLD_ID,
      isPastMember: true,
    }));

    const { getByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-past-member-note')).toBeTruthy();
  });

  it('omits it for an active nanny', () => {
    const { queryByTestId } = render(<HoursScreen />);
    expect(queryByTestId('hours-past-member-note')).toBeNull();
  });

  it('renders it for a removed parent too', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'parent',
      householdId: HOUSEHOLD_ID,
      isPastMember: true,
    }));
    mockUseWeekTimesheet.mockImplementation(submittedWeek);

    const { getByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-past-member-note')).toBeTruthy();
  });

  // The discriminating case: a helper is read-only (`!isParentEditorRole`)
  // while still being a current member. Passing `readOnly` where
  // `isPastMember` belongs would tell her she had left the household.
  it('does NOT show it to a read-only helper who is still a member', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'helper',
      householdId: HOUSEHOLD_ID,
      isPastMember: false,
    }));
    mockUseWeekTimesheet.mockImplementation(submittedWeek);

    const { queryByTestId } = render(<HoursScreen />);

    expect(queryByTestId('hours-past-member-note')).toBeNull();
    // She really is read-only — otherwise this test would pass for the wrong
    // reason (a helper who could approve).
    expect(queryByTestId('hours-approve-button')).toBeNull();
  });
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
      household: { id: HOUSEHOLD_ID, timezone: TIMEZONE, week_starts_on: 1 },
      householdId: HOUSEHOLD_ID,
      households: [{ id: HOUSEHOLD_ID, timezone: TIMEZONE, week_starts_on: 1 }],
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
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE, 1);
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
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE, 1);
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
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE, 1);
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
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE, 1);
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
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE, 1);
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
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE, 1);
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
    const currentWeekStart = getWeekStartISO(new Date(), TIMEZONE, 1);
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
      // `useWeekTimesheet` returns EVERY carer's row for the week (F-B1-3).
      data: [
        {
          id: '4359148e-d5ee-4515-9fca-3396b29ee48d',
          carer_id: null,
          carer_display_name: 'Amara',
          status: 'approved',
          query_note: null,
        },
      ],
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
      data: [
        {
          id: '4359148e-d5ee-4515-9fca-3396b29ee48d',
          carer_id: null,
          carer_display_name: 'Amara',
          status: 'submitted',
          query_note: null,
        },
      ],
      isLoading: false,
    }));

    const { getByTestId } = render(<HoursScreen />);
    fireEvent.press(getByTestId('hours-week-prev'));

    expect(getByTestId('hours-approve-button').props.disabled).toBe(false);
    expect(getByTestId('hours-query-button').props.disabled).toBe(false);
  });
});

// The removed nanny can now reach the household she left, so this screen is
// the one that has to stop offering her writes. Read access is the point of
// the feature; a write affordance on a household she is no longer a member of
// would fail server-side anyway (all writes stay active-only) — offering it
// is a lie the UI must not tell.
describe('HoursScreen — a past household is read-only', () => {
  function pastMember() {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'nanny',
      householdId: HOUSEHOLD_ID,
      isPastMember: true,
    }));
  }

  it('offers the nanny no add-expense button on a household she was removed from', () => {
    pastMember();
    const { queryByTestId } = render(<HoursScreen />);
    expect(queryByTestId('expenses-add')).toBeNull();
  });

  // The discriminating half: hiding it unconditionally would also pass the
  // test above.
  it('still offers add-expense on a household she is an active member of', () => {
    const { getByTestId } = render(<HoursScreen />);
    expect(getByTestId('expenses-add')).toBeTruthy();
  });

  it('still shows her the hours themselves on a past household', () => {
    pastMember();
    const { getByTestId } = render(<HoursScreen />);
    expect(getByTestId('hours-title')).toBeTruthy();
    expect(getByTestId('hours-week-prev')).toBeTruthy();
  });

  it('offers a removed parent no approve action on a past household', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'parent',
      householdId: HOUSEHOLD_ID,
      isPastMember: true,
    }));
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: [
        {
          id: '4359148e-d5ee-4515-9fca-3396b29ee48d',
          carer_id: null,
          carer_display_name: 'Amara',
          status: 'submitted',
          query_note: null,
        },
      ],
      isLoading: false,
    }));

    const { queryByTestId } = render(<HoursScreen />);

    expect(queryByTestId('hours-approve-button')).toBeNull();
    expect(queryByTestId('hours-query-button')).toBeNull();
  });

  // Discriminating half for the parent path.
  it('still offers approve to a parent who is an active member', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'parent',
      householdId: HOUSEHOLD_ID,
      isPastMember: false,
    }));
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: [
        {
          id: '4359148e-d5ee-4515-9fca-3396b29ee48d',
          carer_id: null,
          carer_display_name: 'Amara',
          status: 'submitted',
          query_note: null,
        },
      ],
      isLoading: false,
    }));

    const { getByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-approve-button')).toBeTruthy();
  });
});

// The user's report: a payment's "For the week" row was reachable but the
// BREAKDOWN behind it was not — landing on the week still meant hunting for
// the money card. `PaymentDetailSheet` now pushes `?weekStart=…&breakdown=1`
// and this screen must consume BOTH params, open the breakdown on whichever
// week view it renders, and clear both so a later Hours visit is clean.
describe('HoursScreen — deep-link breakdown', () => {
  const CARER_ID = 'carer-1';
  const NOW = '2026-08-01T00:00:00.000Z';

  function seedPricedWeek(weekStart: string) {
    mockUseWeekTimesheet.mockImplementation(() => ({
      data: [
        {
          id: 'ts-1',
          household_id: HOUSEHOLD_ID,
          carer_id: CARER_ID,
          carer_display_name: 'Alex',
          week_start: weekStart,
          total_minutes: 480,
          status: 'submitted',
          approved_by: null,
          approved_at: null,
          query_note: null,
          created_at: NOW,
          updated_at: NOW,
          earnings: {
            status: 'ok',
            week_start: weekStart,
            currency: 'GBP',
            lines: [
              {
                kind: 'regular',
                minutes: 480,
                rate_minor: 1850,
                multiplier: null,
                amount_minor: 14800,
                from_date: weekStart,
                to_date: weekStart,
                arrangement_id: 'arr-1',
              },
            ],
            gross_minor: 14800,
            reimbursements_minor: 0,
            worked_minutes: 480,
            payable_minutes: 480,
            guaranteed_minutes_per_week: null,
          },
        },
      ],
      isLoading: false,
    }));
  }

  beforeEach(() => {
    useAuthStore.setState({
      session: { user: { id: CARER_ID } } as unknown as never,
      user: { id: CARER_ID } as unknown as never,
      isInitialized: true,
    } as never);
  });

  it('opens the week view breakdown when breakdown=1 rides along with weekStart', async () => {
    const threeWeeksBack = addWeeks(
      getWeekStartISO(new Date(), TIMEZONE, 1),
      -3
    );
    seedPricedWeek(threeWeeksBack);
    mockUseLocalSearchParams.mockImplementation(() => ({
      weekStart: threeWeeksBack,
      breakdown: '1',
    }));

    const { getByTestId } = render(<HoursScreen />);

    await waitFor(() =>
      expect(getByTestId('earnings-breakdown-stub')).toBeTruthy()
    );
  });

  it('leaves the breakdown shut when only weekStart is deep-linked', async () => {
    const threeWeeksBack = addWeeks(
      getWeekStartISO(new Date(), TIMEZONE, 1),
      -3
    );
    seedPricedWeek(threeWeeksBack);
    mockUseLocalSearchParams.mockImplementation(() => ({
      weekStart: threeWeeksBack,
    }));

    const { getByTestId, queryByTestId } = render(<HoursScreen />);

    await waitFor(() => expect(getByTestId('hours-total')).toBeTruthy());
    expect(queryByTestId('earnings-breakdown-stub')).toBeNull();
  });

  // THE regression guard. A `breakdown` param left on the route re-opens the
  // sheet on every later visit to the Hours tab (it does not unmount on
  // blur) — exactly the D15 trap `weekStart` already had to be taught.
  it('clears the breakdown param off the route, not just weekStart', async () => {
    const threeWeeksBack = addWeeks(
      getWeekStartISO(new Date(), TIMEZONE, 1),
      -3
    );
    seedPricedWeek(threeWeeksBack);
    mockUseLocalSearchParams.mockImplementation(() => ({
      weekStart: threeWeeksBack,
      breakdown: '1',
    }));

    render(<HoursScreen />);

    await waitFor(() =>
      expect(mockSetParams).toHaveBeenCalledWith(
        expect.objectContaining({
          weekStart: undefined,
          breakdown: undefined,
        })
      )
    );
  });

  it('does not re-open the breakdown on a later visit with no params', async () => {
    const threeWeeksBack = addWeeks(
      getWeekStartISO(new Date(), TIMEZONE, 1),
      -3
    );
    seedPricedWeek(threeWeeksBack);
    mockUseLocalSearchParams.mockImplementation(() => ({
      weekStart: threeWeeksBack,
      breakdown: '1',
    }));

    const first = render(<HoursScreen />);
    await waitFor(() =>
      expect(first.getByTestId('earnings-breakdown-stub')).toBeTruthy()
    );
    first.unmount();

    seedPricedWeek(getWeekStartISO(new Date(), TIMEZONE, 1));
    mockUseLocalSearchParams.mockImplementation(() => ({}));
    const second = render(<HoursScreen />);

    await waitFor(() => expect(second.getByTestId('hours-total')).toBeTruthy());
    expect(second.queryByTestId('earnings-breakdown-stub')).toBeNull();
  });
});

// WP-A2 step 3 — Pattern A NAVIGATION-TIME (`docs/CROSS-CUTTING-DEFECT-
// PATTERNS.md` §A). A push about family B used to open family A's week and
// say nothing about it: `householdId` rode the URL and this tab ignored it.
describe('HoursScreen — deep-link householdId (Pattern A)', () => {
  const OTHER_HOUSEHOLD_ID = 'e1c9f2a4-0f6b-4d3a-9a1e-77c0b5d21f34';

  const multiHousehold =
    (activeId: string, weekStartsOn = 1) =>
    () => {
      const households = [
        {
          id: HOUSEHOLD_ID,
          name: 'The Smiths',
          timezone: TIMEZONE,
          week_starts_on: 1,
        },
        {
          id: OTHER_HOUSEHOLD_ID,
          name: 'The Patels',
          timezone: TIMEZONE,
          week_starts_on: weekStartsOn,
        },
      ];
      return {
        household: households.find(h => h.id === activeId) ?? null,
        householdId: activeId,
        households,
        pastHouseholds: [],
        setActiveHouseholdId: mockSetActiveHouseholdId,
        isLoading: false,
        isError: false,
      };
    };

  it('switches to the household the push names, once, and says so', async () => {
    mockUseActiveHousehold.mockImplementation(multiHousehold(HOUSEHOLD_ID));
    mockUseLocalSearchParams.mockImplementation(() => ({
      householdId: OTHER_HOUSEHOLD_ID,
    }));

    const { rerender } = render(<HoursScreen />);

    await waitFor(() =>
      expect(mockSetActiveHouseholdId).toHaveBeenCalledWith(OTHER_HOUSEHOLD_ID)
    );
    expect(mockShowInfoToast).toHaveBeenCalledTimes(1);

    // The tab never unmounts — a re-render must not re-fire either.
    rerender(<HoursScreen />);
    expect(mockSetActiveHouseholdId).toHaveBeenCalledTimes(1);
    expect(mockShowInfoToast).toHaveBeenCalledTimes(1);
  });

  it('does not switch when the push names the household already showing', async () => {
    mockUseActiveHousehold.mockImplementation(multiHousehold(HOUSEHOLD_ID));
    mockUseLocalSearchParams.mockImplementation(() => ({
      householdId: HOUSEHOLD_ID,
    }));

    const { getByTestId } = render(<HoursScreen />);

    await waitFor(() => expect(getByTestId('hours-hero-band')).toBeTruthy());
    expect(mockSetActiveHouseholdId).not.toHaveBeenCalled();
    expect(mockShowInfoToast).not.toHaveBeenCalled();
  });

  it('renders the not-a-member error state, and switches nothing, for a household she is not in', () => {
    mockUseActiveHousehold.mockImplementation(multiHousehold(HOUSEHOLD_ID));
    mockUseLocalSearchParams.mockImplementation(() => ({
      householdId: 'a-household-she-was-never-in',
    }));

    const { getByTestId, queryByTestId } = render(<HoursScreen />);

    expect(getByTestId('hours-not-member')).toBeTruthy();
    expect(queryByTestId('hours-hero-band')).toBeNull();
    expect(mockSetActiveHouseholdId).not.toHaveBeenCalled();
    expect(mockShowInfoToast).not.toHaveBeenCalled();
  });

  // THE ordering bug. `weekStart` is absolute; the offset it becomes is
  // measured against the ACTIVE household's week anchor (its timezone AND its
  // `week_starts_on`). Consumed before the switch lands it anchors on the
  // wrong family and then clears the param, destroying the evidence.
  it('waits for the switch to land before turning weekStart into an offset', async () => {
    // The target household starts its week on SUNDAY — an offset measured
    // against the current household's Monday anchor cannot land on it.
    const sundayAnchor = getWeekStartISO(new Date(), TIMEZONE, 0);
    const targetWeek = addWeeks(sundayAnchor, -3);
    mockUseActiveHousehold.mockImplementation(multiHousehold(HOUSEHOLD_ID, 0));
    mockUseLocalSearchParams.mockImplementation(() => ({
      householdId: OTHER_HOUSEHOLD_ID,
      weekStart: targetWeek,
    }));

    const { rerender, getByTestId } = render(<HoursScreen />);

    // Still on the old household: nothing consumed, nothing cleared.
    expect(mockSetParams).not.toHaveBeenCalled();

    mockUseActiveHousehold.mockImplementation(
      multiHousehold(OTHER_HOUSEHOLD_ID, 0)
    );
    rerender(<HoursScreen />);

    await waitFor(() => expect(mockSetParams).toHaveBeenCalled());
    expect(getByTestId(`hours-active-week-${targetWeek}`)).toBeTruthy();
  });

  // P4: a nanny in two families must be able to move between them from the
  // tab she is standing on, without losing the week she is reading.
  it('mounts the household switcher', () => {
    mockUseActiveHousehold.mockImplementation(multiHousehold(HOUSEHOLD_ID));

    const { getByTestId } = render(<HoursScreen />);

    expect(getByTestId('household-switcher-stub')).toBeTruthy();
  });
});
