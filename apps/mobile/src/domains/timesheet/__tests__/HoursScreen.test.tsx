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
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));

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

  const mod = await import('../components/HoursScreen');
  HoursScreen = mod.HoursScreen;
});

beforeEach(() => {
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseWeekTimeEntries.mockClear();
  mockUseWeekTimesheet.mockClear();
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
