/**
 * @module domains/today/__tests__/TodayCoverage.error
 *
 * The coverage surface owns the parent's pinned slot on an ordinary day, so
 * "the read failed" is now a state a parent can actually be looking at. It
 * must SAY so: a card that renders nothing on a dropped connection is
 * indistinguishable from a day with nothing to report, and this card's whole
 * job is telling him whether his children are covered
 * (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import { fireEvent } from '@testing-library/react-native';
import { View } from 'react-native';
import i18n from '@/src/i18n';
import { renderWithProviders, serializeTree } from '@/src/test-utils';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ZONE = 'Europe/London';
const PINNED_NOW = new Date('2026-08-10T09:00:00.000Z');

/** Nothing here may read as a verdict about cover — the app does not know. */
const REASSURANCE_PATTERNS = [
  /everything you asked for is booked/i,
  /everything'?s covered/i,
  /isn'?t fully covered/i,
  /no cover today/i,
];

setSystemTime(PINNED_NOW);
afterAll(() => setSystemTime());

function makeCommitment(): ChildCommitment {
  return {
    id: COMMITMENT_ID,
    child_id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    kind: 'school',
    label: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    start_time: '09:00:00',
    end_time: '17:00:00',
    starts_on: null,
    ends_on: null,
    exdates: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

let TodayCoverage: typeof import('../components/TodayCoverage').TodayCoverage;
let mockShiftsRange: ReturnType<typeof mock>;
let refetchShifts: ReturnType<typeof mock>;

beforeAll(async () => {
  await i18n.changeLanguage('en');

  mock.module('react-i18next', () => ({
    useTranslation: (ns?: string | string[]) => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const namespace = Array.isArray(ns)
          ? (ns[0] ?? 'today')
          : (ns ?? 'today');
        return options
          ? i18n.t(`${namespace}:${key}`, options)
          : i18n.t(`${namespace}:${key}`);
      },
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));

  refetchShifts = mock();
  mockShiftsRange = mock(() => ({
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: true,
    refetch: refetchShifts,
  }));

  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockShiftsRange,
  }));
  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: () => ({
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      refetch: mock(),
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      refetch: mock(),
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: () => ({
      data: [makeCommitment()],
      isLoading: false,
      isPending: false,
      isError: false,
      refetch: mock(),
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
    useHouseholdClosures: () => ({
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      refetch: mock(),
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
    useCreateParentCover: () => ({
      isPending: false,
      mutateAsync: mock(() => Promise.resolve({})),
    }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: () => ({ disabled: false, reason: null }),
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
    router: { push: mock(), back: mock(), replace: mock() },
    Link: 'Link',
    Redirect: 'Redirect',
    Stack: { Screen: 'StackScreen' },
    Tabs: { Screen: 'TabsScreen' },
  }));

  const mod = await import('../components/TodayCoverage');
  TodayCoverage = mod.TodayCoverage;
});

beforeEach(() => {
  refetchShifts.mockClear();
});

function renderCoverage(footer?: React.ReactNode) {
  return renderWithProviders(
    <TodayCoverage
      householdId={HOUSEHOLD_ID}
      timeZone={ZONE}
      weekStartsOn={1}
      householdChildren={[{ id: CHILD_ID, name: 'H1 Child1' } as never]}
      footer={footer}
    />
  );
}

function testIdIndex(
  tree: ReturnType<typeof renderWithProviders>,
  testId: string
): number {
  const order: string[] = [];
  function walk(node: unknown): void {
    if (node == null || typeof node !== 'object') return;
    const record = node as {
      props?: { testID?: string; children?: unknown };
      children?: unknown;
    };
    const id = record.props?.testID;
    if (id) order.push(id);
    const children = record.children ?? record.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    } else if (children) {
      walk(children);
    }
  }
  walk(tree.toJSON());
  return order.indexOf(testId);
}

describe('TodayCoverage — the failed read', () => {
  it('renders today-coverage-retry and never a gap card or reassurance copy', () => {
    const tree = renderCoverage();

    expect(tree.getByTestId('today-coverage-retry')).toBeTruthy();
    expect(tree.queryByTestId('today-coverage-gap-card')).toBeNull();
    expect(tree.queryByTestId('today-coverage-day-bar')).toBeNull();

    const rendered = serializeTree(tree.toJSON());
    for (const pattern of REASSURANCE_PATTERNS) {
      expect(rendered).not.toMatch(pattern);
    }
    expect(rendered).toContain(i18n.t('errors:network'));
  });

  it('pressing today-coverage-retry-button calls refetch', () => {
    const tree = renderCoverage();

    fireEvent.press(tree.getByTestId('today-coverage-retry-button'));

    expect(refetchShifts).toHaveBeenCalled();
  });

  // The handoff chips fold into this surface on the parent side, and a failed
  // coverage read says nothing about whether a handoff happened.
  it('renders the footer beneath the retry', () => {
    const tree = renderCoverage(<View testID="coverage-footer" />);

    expect(tree.getByTestId('coverage-footer')).toBeTruthy();
    expect(testIdIndex(tree, 'today-coverage-retry')).toBeLessThan(
      testIdIndex(tree, 'coverage-footer')
    );
  });
});
