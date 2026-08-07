/**
 * @module domains/today/__tests__/TodayScreen.cardOrder.test
 *
 * Pins the Today card ORDER: the two cards that exist only because something
 * needs this person's action (`NeedsAttentionCard`, `PendingScheduleCard`)
 * render before the routine cards that are always there (clock-in, handoff
 * chips, this week's shifts).
 *
 * Why this is worth a test: both attention cards render `null` on an ordinary
 * day, so nothing on screen hints at their position — but when a week IS
 * waiting, the respond CTA is the only route into the accept flow. Behind the
 * routine cards it fell BELOW THE FOLD on a nanny's Today screen (measured on
 * an iPhone 17 Pro Max: CTA at y 881–929, scroll viewport ending at y 873), so
 * a nanny opening the app saw no call to action at all, and a tap at the CTA's
 * reported centre landed on the Hours tab button underneath instead. Ordering
 * is the fix; this test stops it regressing.
 *
 * Hooks are mocked via `mock.module()` in `beforeAll` before the dynamic
 * import, per docs/09-TESTING.md / TodayScreen.wash.test.tsx.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
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
mock.module('@/src/components/ui/empty-state', () => {
  const React = require('react');
  return {
    EmptyState: () =>
      React.createElement('View', { testID: 'empty-state-stub' }),
  };
});

/**
 * Every card renders the same testID with its name on `accessibilityLabel`, so
 * `getAllByTestId` returns them in tree order and the names read out directly.
 */
const ORDER_MARKER = 'today-card-order-marker';
function marker(name: string) {
  const React = require('react');
  return () =>
    React.createElement('View', {
      testID: ORDER_MARKER,
      accessibilityLabel: name,
    });
}

mock.module('@/src/domains/household', () => ({
  HouseholdSwitcher: () => null,
}));
mock.module('@/src/domains/schedule', () => ({
  PendingScheduleCard: marker('pending-schedule'),
  ThisWeeksShiftsCard: marker('this-weeks-shifts'),
}));
mock.module('@/src/domains/inbox', () => ({
  NeedsAttentionCard: marker('needs-attention'),
}));
mock.module('@/src/domains/today/components/ClockInCard', () => ({
  ClockInCard: marker('clock-in'),
}));
mock.module('@/src/domains/today/components/CoverageGapBanner', () => ({
  CoverageGapBanner: marker('coverage-gap'),
}));
mock.module('@/src/domains/today/components/HandoffChipsCard', () => ({
  HandoffChipsCard: marker('handoff-chips'),
}));
mock.module('@/src/domains/today/components/NannyLiveStatusCard', () => ({
  NannyLiveStatusCard: marker('nanny-live-status'),
}));

const HOUSEHOLD_ID = 'household-order-1';

let TodayScreen: typeof import('../components/TodayScreen').TodayScreen;
let mockUseIsOnboarded: ReturnType<typeof mock>;

beforeAll(async () => {
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));

  mock.module('@/src/domains/today/hooks/useHouseholdIsLive', () => ({
    useHouseholdIsLive: mock(() => false),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mock(() => ({
      household: {
        id: HOUSEHOLD_ID,
        name: 'Order Household',
        timezone: 'UTC',
      },
      householdId: HOUSEHOLD_ID,
      households: [
        { id: HOUSEHOLD_ID, name: 'Order Household', timezone: 'UTC' },
      ],
      pastHouseholds: [],
      isPastHousehold: false,
      setActiveHouseholdId: mock(),
      isLoading: false,
    })),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: mock(() => ({ data: [], isLoading: false })),
  }));

  const mod = await import('../components/TodayScreen');
  TodayScreen = mod.TodayScreen;
});

function renderOrder(role: 'nanny' | 'parent'): string[] {
  mockUseIsOnboarded.mockImplementation(() => ({
    status: 'onboarded',
    role,
    householdId: HOUSEHOLD_ID,
  }));
  const { getAllByTestId } = render(<TodayScreen />);
  return getAllByTestId(ORDER_MARKER).map(
    node => node.props.accessibilityLabel as string
  );
}

describe('TodayScreen — card order', () => {
  it("puts the nanny's attention cards above every routine card", () => {
    const order = renderOrder('nanny');

    // Everything that only appears when it needs action comes first.
    expect(order.indexOf('needs-attention')).toBeLessThan(
      order.indexOf('clock-in')
    );
    expect(order.indexOf('pending-schedule')).toBeLessThan(
      order.indexOf('clock-in')
    );
    expect(order.indexOf('pending-schedule')).toBeLessThan(
      order.indexOf('handoff-chips')
    );
    expect(order.indexOf('pending-schedule')).toBeLessThan(
      order.indexOf('this-weeks-shifts')
    );
  });

  it("puts the parent's attention cards above every routine card", () => {
    const order = renderOrder('parent');

    expect(order.indexOf('needs-attention')).toBeLessThan(
      order.indexOf('nanny-live-status')
    );
    expect(order.indexOf('needs-attention')).toBeLessThan(
      order.indexOf('handoff-chips')
    );
    expect(order.indexOf('needs-attention')).toBeLessThan(
      order.indexOf('this-weeks-shifts')
    );
  });

  it('still renders the routine cards it moved past', () => {
    const order = renderOrder('nanny');
    expect(order).toContain('clock-in');
    expect(order).toContain('coverage-gap');
    expect(order).toContain('handoff-chips');
    expect(order).toContain('this-weeks-shifts');
  });

  // Clocking in to a household she was removed from would 403 server-side —
  // all writes stay active-only. Offering the button is a lie.
  it('offers no clock-in on a household she was removed from', () => {
    mockUseIsOnboarded.mockImplementation(() => ({
      status: 'onboarded',
      role: 'nanny',
      householdId: HOUSEHOLD_ID,
      isPastMember: true,
    }));

    const { getAllByTestId } = render(<TodayScreen />);
    const order = getAllByTestId(ORDER_MARKER).map(
      node => node.props.accessibilityLabel as string
    );

    expect(order).not.toContain('clock-in');
  });
});
