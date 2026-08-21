/**
 * @module app/(private)/(tabs)/__tests__/schedule.behavior.test
 *
 * Pattern B render test for ScheduleRoute — the role fork must not conflate
 * "role still loading" with "no membership yet" or "memberships query
 * errored": `useIsOnboarded().role` is null in all three situations, but
 * each needs its own affordance (loading spinner / empty state / error
 * state with retry). An errored memberships query reports
 * `status: 'loading'` PLUS `membershipsError: true` (see `useIsOnboarded`),
 * so the error check must be checked before, and win over, the loading
 * check — that ordering is what this file's error-state test guards. Also
 * covers the existing nanny/parent/helper forks once role is known.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

const mockRetryMemberships = mock(() => {});
const mockUseIsOnboarded = mock(
  (): {
    status: 'loading' | 'onboarded' | 'not-onboarded';
    role: 'nanny' | 'parent' | 'helper' | null;
    householdId: string | null;
    membershipsError: boolean;
    retryMemberships: () => void;
  } => ({
    status: 'loading',
    role: null,
    householdId: null,
    membershipsError: false,
    retryMemberships: mockRetryMemberships,
  })
);

const mockUseActiveHousehold = mock(
  (): { household: { state: 'draft' | 'live' } | null } => ({
    household: null,
  })
);

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: mockUseActiveHousehold,
}));

mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
  useIsOnboarded: mockUseIsOnboarded,
}));

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
        testID: 'error-state-mock',
        accessibilityLabel: props.variant ?? 'no-variant',
        onPress: props.onRetry,
      }),
  };
});

mock.module('@/src/components/ui/empty-state', () => {
  const React = require('react');
  return {
    EmptyState: (props: { title?: string; description?: string }) =>
      React.createElement('View', {
        testID: 'empty-state-mock',
        accessibilityLabel: `${props.title ?? ''}|${props.description ?? ''}`,
      }),
  };
});

mock.module('@/src/domains/schedule', () => {
  const React = require('react');
  return {
    SchedulePendingScreen: () =>
      React.createElement('View', { testID: 'schedule-pending-screen-mock' }),
    ScheduleShiftsScreen: ({
      showBack,
      patternBanner,
      pattern,
    }: {
      showBack?: boolean;
      // Now a render prop: the real screen hands the banner this week's
      // uncovered-count node so the caller can fold it INTO the banner card.
      // Passing null here stands in for "no gaps this week".
      patternBanner?: unknown;
      pattern?: { status: string } | null;
    }) =>
      React.createElement(
        'View',
        {
          testID: 'schedule-shifts-screen-mock',
          accessibilityLabel: showBack === false ? 'no-back' : 'with-back',
          accessibilityHint: pattern?.status ?? 'none',
        },
        typeof patternBanner === 'function'
          ? (patternBanner as (n: unknown) => unknown)(null)
          : patternBanner
      ),
    // A thin stand-in mirroring the real banner's per-state message, so
    // this file can assert the message text without pulling in the real
    // component's own hooks (useHouseholdMembers etc.) — those are covered
    // by SchedulePatternBanner.test.tsx. `carerId` is echoed via
    // accessibilityLabel so the S7/S8 per-carer tests below can tell which
    // banner is which without pulling in the real component.
    SchedulePatternBanner: ({
      pattern,
      isLoading,
      carerId,
    }: {
      pattern: { status: string } | null;
      isLoading?: boolean;
      carerId?: string | null;
    }) =>
      isLoading
        ? null
        : React.createElement(
            'Text',
            {
              testID: 'schedule-pattern-banner-status',
              accessibilityLabel: carerId ?? 'no-carer',
            },
            pattern?.status ?? 'none'
          ),
  };
});

const mockUseSchedulePatterns = mock(
  (): {
    data:
      | Array<{
          status: string;
          id?: string;
          carer_id?: string;
          created_at?: string;
        }>
      | undefined;
  } => ({
    data: undefined,
  })
);

mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
  useSchedulePatterns: mockUseSchedulePatterns,
}));

// S7/S8: not mocked by any existing test below (default `{ data: undefined
// }`, i.e. "not loaded yet") — `ParentPatternBanners`' carer-id list then
// falls back entirely to whichever carer_id(s) show up in the patterns
// list, which is exactly the single-banner precedent every pre-existing
// test in this file already exercises.
const mockUseHouseholdCarers = mock(
  (): { data: Array<{ user_id: string }> | undefined; isLoading: boolean } => ({
    data: undefined,
    isLoading: false,
  })
);

mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: mockUseHouseholdCarers,
}));

const mockPush = mock(() => {});

mock.module('expo-router', () => ({
  // `SettingsHeaderButton` in the header band reaches for the singleton.
  router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  useRouter: () => ({ push: mockPush }),
}));

let ScheduleRoute: typeof import('../schedule').default;

beforeAll(async () => {
  ScheduleRoute = (await import('../schedule')).default;
});

beforeEach(() => {
  mockUseIsOnboarded.mockReset();
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'loading' as const,
    role: null,
    householdId: null,
    membershipsError: false,
    retryMemberships: mockRetryMemberships,
  }));
  mockRetryMemberships.mockReset();
  mockUseSchedulePatterns.mockReset();
  mockUseSchedulePatterns.mockImplementation(() => ({ data: undefined }));
  mockUseHouseholdCarers.mockReset();
  mockUseHouseholdCarers.mockImplementation(() => ({
    data: undefined,
    isLoading: false,
  }));
  mockPush.mockReset();
  mockUseActiveHousehold.mockReset();
  mockUseActiveHousehold.mockImplementation(() => ({ household: null }));
});

describe('ScheduleRoute — role fork (Wave A3 + role === null triage)', () => {
  it('shows loading UI while role resolution is in flight', () => {
    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-loading')).toBeTruthy();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();
    expect(queryByTestId('schedule-shifts-screen-mock')).toBeNull();
    expect(queryByTestId('empty-state-mock')).toBeNull();
    expect(queryByTestId('error-state-mock')).toBeNull();
  });

  it('shows an empty state, not a spinner, when the user genuinely has no membership', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'not-onboarded' as const,
      role: null,
      householdId: null,
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-empty')).toBeTruthy();
    expect(getByTestId('empty-state-mock')).toBeTruthy();
    expect(queryByTestId('schedule-tab-loading')).toBeNull();
    expect(queryByTestId('error-state-mock')).toBeNull();
  });

  it('shows an error state with retry when membershipsError is true, even though status reports loading (an errored memberships query reports status: "loading" — see useIsOnboarded — and must not be swallowed by the loading check)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'loading' as const,
      role: null,
      householdId: null,
      membershipsError: true,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-error')).toBeTruthy();
    expect(queryByTestId('empty-state-mock')).toBeNull();
    expect(queryByTestId('schedule-tab-loading')).toBeNull();

    fireEvent.press(getByTestId('error-state-mock'));
    expect(mockRetryMemberships).toHaveBeenCalledTimes(1);
  });

  it('shows the draft empty state — honest, hers, never "the family is still setting up" (D-36 §S6 item 4)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'nanny' as const,
      householdId: 'draft-1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseActiveHousehold.mockImplementation(() => ({
      household: { state: 'draft' as const },
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-tab-draft-empty')).toBeTruthy();
    expect(queryByTestId('schedule-shifts-screen-mock')).toBeNull();
  });

  it('routes nanny role to ScheduleShiftsScreen without back', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'nanny' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-shifts-screen-mock')).toBeTruthy();
    expect(
      getByTestId('schedule-shifts-screen-mock').props.accessibilityLabel
    ).toBe('no-back');
    expect(queryByTestId('schedule-tab-loading')).toBeNull();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();
  });

  // P0 0.2: a nanny's empty-state copy needs to know whether an accepted
  // pattern exists too ("the family hasn't set your schedule yet" vs "no
  // shifts this week") — so `useSchedulePatterns` can no longer be gated to
  // non-nanny roles only, and the result must reach ScheduleShiftsScreen.
  it('fetches schedule patterns for a NANNY too (not gated to null), and passes the pattern down', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'nanny' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [{ status: 'accepted', id: 'p1' }],
    }));

    const { getByTestId } = render(<ScheduleRoute />);

    expect(mockUseSchedulePatterns).toHaveBeenCalledWith('h1');
    expect(
      getByTestId('schedule-shifts-screen-mock').props.accessibilityHint
    ).toBe('accepted');
  });

  // REGRESSION (WS-G): a full-screen SchedulePendingScreen used to fork on
  // pattern status — only `accepted` got the calendar, every other state
  // (pending/draft/declined/withdrawn/none) hid it, along with any
  // still-live shifts from a previously accepted pattern, one-off shifts
  // (which exist WITHOUT any pattern at all), and the "Add a one-off
  // shift" button. The calendar (ScheduleShiftsScreen) now renders for
  // EVERY pattern state — only the banner above it changes.
  it.each([
    ['pending', { status: 'pending' }],
    ['draft', { status: 'draft' }],
    ['declined', { status: 'declined' }],
    ['withdrawn', { status: 'withdrawn' }],
    ['accepted', { status: 'accepted' }],
    ['no pattern at all', null],
  ])('parent role always renders the calendar (pattern state: %s), never the full-screen pending takeover', (_label, pattern) => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'parent' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: pattern ? [pattern] : [],
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-shifts-screen-mock')).toBeTruthy();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();

    const banner = getByTestId('schedule-pattern-banner-status');
    expect(banner.children[0]).toBe(pattern?.status ?? 'none');
    expect(
      getByTestId('schedule-shifts-screen-mock').props.accessibilityHint
    ).toBe(pattern?.status ?? 'none');
  });

  // NOTE: the accepted-banner "Change it resumes by ?patternId=" regression
  // (previously a route-level test here) now lives in
  // SchedulePatternBanner.test.tsx, where the real banner's routing runs.
  it('one-off shift with NO pattern at all: calendar still renders (source_pattern_id is nullable, origin parent_proposed)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'parent' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    mockUseSchedulePatterns.mockImplementation(() => ({ data: [] }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    // ScheduleShiftsScreen owns the shift list/one-off button internally —
    // this file only needs to prove the calendar shell mounts (not hidden
    // behind SchedulePendingScreen) when there's no pattern to speak of.
    expect(getByTestId('schedule-shifts-screen-mock')).toBeTruthy();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();
  });

  // REGRESSION: the route took `.find(p => p.status !== 'ended')`, so
  // whichever non-ended row the API listed first won. A household holding a
  // stale `withdrawn` plus a freshly-sent `pending` rendered "You withdrew
  // your usual week" while a week was genuinely with the nanny. Precedence
  // now lives in `resolveActivePattern` (patternPrecedence.ts).
  it.each([
    [
      'withdrawn listed first',
      [{ status: 'withdrawn' }, { status: 'pending' }],
    ],
    ['pending listed first', [{ status: 'pending' }, { status: 'withdrawn' }]],
  ])('picks the pending pattern regardless of list order (%s)', (_label, data) => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'parent' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseSchedulePatterns.mockImplementation(() => ({ data }));

    const { getByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'pending'
    );
    expect(
      getByTestId('schedule-shifts-screen-mock').props.accessibilityHint
    ).toBe('pending');
  });

  // `ended` used to be filtered out, so a household whose week had run its
  // course fell through to the "no usual week yet" copy — wrong, and it
  // erased the fact that there had ever been one.
  it('passes an ENDED pattern through rather than filtering it to null', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'parent' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [{ status: 'ended' }],
    }));

    const { getByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-pattern-banner-status').children[0]).toBe(
      'ended'
    );
  });

  // S7/S8: a household with TWO nannies used to collapse to ONE banner
  // (`resolveActivePattern` picking a single household-wide winner) —
  // there was no entry point to build a usual week for the second nanny at
  // all. One `SchedulePatternBanner` per carer now, carer-list order, each
  // with its OWN resolved pattern (or null).
  it('S7/S8: two carers -> two banners, each with its own resolved pattern (one accepted, one with none)', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'parent' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseHouseholdCarers.mockImplementation(() => ({
      data: [{ user_id: 'nanny-1' }, { user_id: 'nanny-2' }],
      isLoading: false,
    }));
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [
        { status: 'accepted', carer_id: 'nanny-1', created_at: '2026-01-01' },
      ],
    }));

    const { getAllByTestId } = render(<ScheduleRoute />);

    const banners = getAllByTestId('schedule-pattern-banner-status');
    expect(banners).toHaveLength(2);
    expect(banners[0]?.props.accessibilityLabel).toBe('nanny-1');
    expect(banners[0]?.children[0]).toBe('accepted');
    // The second nanny has no pattern at all — she used to be entirely
    // invisible; now she gets her own "none" banner.
    expect(banners[1]?.props.accessibilityLabel).toBe('nanny-2');
    expect(banners[1]?.children[0]).toBe('none');
  });

  it('S7/S8: zero carers renders exactly today\'s single "no nanny yet" banner, not zero banners', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'parent' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));
    mockUseHouseholdCarers.mockImplementation(() => ({
      data: [],
      isLoading: false,
    }));
    mockUseSchedulePatterns.mockImplementation(() => ({ data: [] }));

    const { getAllByTestId } = render(<ScheduleRoute />);

    const banners = getAllByTestId('schedule-pattern-banner-status');
    expect(banners).toHaveLength(1);
    expect(banners[0]?.props.accessibilityLabel).toBe('no-carer');
    expect(banners[0]?.children[0]).toBe('none');
  });

  it('routes helper role to the calendar too, never the full-screen pending takeover', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded' as const,
      role: 'helper' as const,
      householdId: 'h1',
      membershipsError: false,
      retryMemberships: mockRetryMemberships,
    }));

    const { getByTestId, queryByTestId } = render(<ScheduleRoute />);

    expect(getByTestId('schedule-shifts-screen-mock')).toBeTruthy();
    expect(queryByTestId('schedule-pending-screen-mock')).toBeNull();
  });
});
