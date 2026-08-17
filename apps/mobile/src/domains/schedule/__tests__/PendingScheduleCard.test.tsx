/**
 * @module domains/schedule/__tests__/PendingScheduleCard.test
 *
 * Covers `PendingScheduleCard` — the nanny's entry point (mounted on Today
 * by another agent) to the respond flow. Renders NOTHING when there is no
 * pending pattern where the signed-in user is the carer (no empty state, no
 * placeholder — invisible on an ordinary day).
 *
 * CROSS-HOUSEHOLD (Pattern A's inverse defect): sourced from
 * `useInboxItems()`'s `pending_pattern` items, which already fan out across
 * EVERY household she belongs to — not just the active one — so a pending
 * week from her OTHER family renders here too, named by ITS OWN household.
 *
 * `useInboxItems` / `useSchedulePattern` / `useActiveHousehold` (which
 * `useHouseholdLookup` reads) / `useAuthStore` / `expo-router` are mocked
 * via `mock.module()` in `beforeAll`, before the dynamic import of the
 * component under test.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { InboxItem } from '@/src/domains/inbox/utils/buildInboxItems';

/** The typography factory always puts the token's base style first in the
 * `style` array (`[baseStyle, weightStyle, tabularStyle, callerStyle]`) —
 * read it directly rather than via RN's `StyleSheet.flatten`, which is a
 * no-op passthrough under this test runtime. */
function baseStyle(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style : [style];
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer && typeof layer === 'object') Object.assign(merged, layer);
  }
  return merged;
}

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

let PendingScheduleCard: typeof import('../components/PendingScheduleCard').PendingScheduleCard;
let mockUseInboxItems: ReturnType<typeof mock>;
let mockUseSchedulePattern: ReturnType<typeof mock>;
let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

const HOUSEHOLD_A_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B_ID = '99999999-9999-4999-8999-999999999999';
const PATTERN_ID = '33333333-3333-4333-8333-333333333333';
const PATTERN_B_ID = '44444444-4444-4444-8444-444444444444';

beforeAll(async () => {
  mockUseInboxItems = mock(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockUseSchedulePattern = mock(() => ({ data: undefined, isLoading: false }));
  mockUseActiveHousehold = mock(() => ({
    household: { id: HOUSEHOLD_A_ID, name: 'Household A', timezone: 'UTC' },
    householdId: HOUSEHOLD_A_ID,
    households: [
      { id: HOUSEHOLD_A_ID, name: 'Household A', timezone: 'UTC' },
      { id: HOUSEHOLD_B_ID, name: 'Household B', timezone: 'UTC' },
    ],
    pastHouseholds: [],
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }));
  mockPush = mock();

  // Override the global key-echo mock: the cross-household test needs the
  // interpolated family name to reach the rendered text.
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, string | number>) =>
        opts ? `${key}(${JSON.stringify(opts)})` : key,
      i18n: { language: 'en', changeLanguage: mock() },
    }),
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('@/src/domains/inbox/hooks/useInboxItems', () => ({
    useInboxItems: mockUseInboxItems,
  }));
  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: mockUseSchedulePattern,
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
  }));

  const mod = await import('../components/PendingScheduleCard');
  PendingScheduleCard = mod.PendingScheduleCard;
});

beforeEach(() => {
  mockPush.mockClear?.();
  mockUseInboxItems.mockImplementation(() => ({
    items: [] as InboxItem[],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockUseSchedulePattern.mockImplementation(() => ({
    data: undefined,
    isLoading: false,
  }));
});

function pendingPatternItem(overrides: Partial<PendingPatternItem> = {}) {
  return {
    kind: 'pending_pattern',
    id: PATTERN_ID,
    householdId: HOUSEHOLD_A_ID,
    patternId: PATTERN_ID,
    dtstart: '2026-08-05',
    ...overrides,
  } satisfies InboxItem;
}

type PendingPatternItem = Extract<InboxItem, { kind: 'pending_pattern' }>;

const patternDays = [
  { weekday: 3, start_time: '08:00', end_time: '13:00' },
  { weekday: 5, start_time: '09:00', end_time: '17:00' },
];

describe('PendingScheduleCard', () => {
  it('renders nothing when there is no pending pattern at all', () => {
    const { queryByTestId, toJSON } = render(<PendingScheduleCard />);

    expect(queryByTestId('today-pending-schedule-card')).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('renders the card with day count + total hours, and navigates to respond on tap', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [pendingPatternItem()],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: { id: PATTERN_ID, days: patternDays },
      isLoading: false,
    }));

    const { getByTestId } = render(<PendingScheduleCard />);

    expect(getByTestId('today-pending-schedule-card')).toBeTruthy();
    const cta = getByTestId('today-pending-schedule-cta');
    expect(cta).toBeTruthy();

    cta.props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/schedule/respond/${PATTERN_ID}`
    );
  });

  it('falls back to the generic title when the household name cannot be resolved', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [pendingPatternItem({ householdId: 'household-unknown' })],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: { id: PATTERN_ID, days: patternDays },
      isLoading: false,
    }));

    const { getByText, queryByText } = render(<PendingScheduleCard />);

    expect(getByText('todayCard.pendingTitle')).toBeTruthy();
    expect(queryByText(/pendingTitleNamed/)).toBeNull();
  });

  it('reports a DISTINCT weekday count, not the number of blocks (handles split days)', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [pendingPatternItem()],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: {
        id: PATTERN_ID,
        days: [
          { weekday: 1, start_time: '07:00', end_time: '13:00' },
          { weekday: 1, start_time: '15:00', end_time: '17:00' },
          { weekday: 3, start_time: '08:00', end_time: '13:00' },
        ],
      },
      isLoading: false,
    }));

    const { getByText } = render(<PendingScheduleCard />);

    // 3 blocks across 2 distinct weekdays must read as 2 days.
    expect(getByText(/todayCard\.pendingBody\(.*"count":2/)).toBeTruthy();
  });

  it('renders nothing while the pattern detail (days) is still loading, to avoid a 0-day flash', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [pendingPatternItem()],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
    }));

    const { queryByTestId } = render(<PendingScheduleCard />);

    expect(queryByTestId('today-pending-schedule-card')).toBeNull();
  });

  // P0-6 (Wave 1-D): routine card title promoted off Body/600 (16/24) onto
  // H4 (18/27 @600).
  it('renders the title at H4, not Body weight="semibold"', () => {
    mockUseInboxItems.mockImplementation(() => ({
      items: [pendingPatternItem()],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: { id: PATTERN_ID, days: patternDays },
      isLoading: false,
    }));

    const { getByText } = render(<PendingScheduleCard />);

    const style = baseStyle(
      getByText(/todayCard\.pendingTitleNamed/).props.style
    );
    expect(style.fontSize).toBe(18);
    expect(style.lineHeight).toBe(27);
  });

  // Pattern A's INVERSE: a pending week from her OTHER family (B) must show
  // here even while household A is the one the switcher has active — the
  // old single-household `useSchedulePatterns(activeHousehold.householdId)`
  // read missed this entirely.
  describe('cross-household (Pattern A inverse)', () => {
    it('renders a pending pattern from a NON-active household, naming it', () => {
      mockUseInboxItems.mockImplementation(() => ({
        items: [
          pendingPatternItem({
            id: PATTERN_B_ID,
            householdId: HOUSEHOLD_B_ID,
            patternId: PATTERN_B_ID,
          }),
        ],
        isLoading: false,
        isError: false,
        refetch: mock(),
      }));
      mockUseSchedulePattern.mockImplementation(() => ({
        data: { id: PATTERN_B_ID, days: patternDays },
        isLoading: false,
      }));

      const { getByTestId, getByText } = render(<PendingScheduleCard />);

      expect(getByTestId('today-pending-schedule-card')).toBeTruthy();
      expect(
        getByText('todayCard.pendingTitleNamed({"family":"Household B"})')
      ).toBeTruthy();

      getByTestId('today-pending-schedule-cta').props.onPress?.();
      expect(mockPush).toHaveBeenCalledWith(
        `/(private)/schedule/respond/${PATTERN_B_ID}`
      );
    });

    it('renders one card PER household when both have a pending pattern', () => {
      mockUseInboxItems.mockImplementation(() => ({
        items: [
          pendingPatternItem(),
          pendingPatternItem({
            id: PATTERN_B_ID,
            householdId: HOUSEHOLD_B_ID,
            patternId: PATTERN_B_ID,
          }),
        ],
        isLoading: false,
        isError: false,
        refetch: mock(),
      }));
      mockUseSchedulePattern.mockImplementation(() => ({
        data: { days: patternDays },
        isLoading: false,
      }));

      const { getAllByTestId } = render(<PendingScheduleCard />);

      expect(getAllByTestId('today-pending-schedule-card')).toHaveLength(2);
    });
  });
});
