/**
 * @module domains/today/__tests__/TodayCoverage.gap
 *
 * THE regression pin for the 10 Aug 2026 contradiction: need-centric gap
 * headline must sit above shift-centric plan lines, with zero reassurance copy.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import { join } from 'node:path';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { View } from 'react-native';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import i18n from '@/src/i18n';
// `renderWithProviders`, not bare `render`: the card now reads the day thread
// to know whether the carer has said she's running late, and a bare render has
// no QueryClient for that hook to hang off.
import { renderWithProviders, serializeTree } from '@/src/test-utils';
import { computeUncoveredToday } from '../hooks/useUncoveredToday';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const ZONE = 'Europe/London';
const LOCAL_DATE = '2026-08-10';
/** 10:00 London — INSIDE the 09:00–11:22 gap, before the 11:22 shift starts.
 * Must stay inside the gap: `computeUncoveredToday` drops windows that have
 * already ended, so a `now` past 11:22 leaves this fixture with no gap at all. */
const PINNED_NOW = new Date('2026-08-10T09:00:00.000Z');

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

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    starts_at: '2026-08-10T10:22:00.000Z',
    ends_at: '2026-08-10T18:22:00.000Z',
    timezone: ZONE,
    local_date: LOCAL_DATE,
    kind: SHIFT_KINDS.RECURRING,
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
    ical_uid: 'uid-1',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    shift_children: [
      {
        id: 'sc-1',
        shift_id: 'shift-1',
        child_id: CHILD_ID,
        starts_at: '2026-08-10T10:22:00.000Z',
        ends_at: '2026-08-10T18:22:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** Household 1 / 10 Aug 2026 — declined 06:00, two cancelled, confirmed 11:22. */
function aug10Shifts(): Shift[] {
  return [
    makeShift({
      id: 'declined-0600',
      status: 'declined',
      starts_at: '2026-08-10T05:00:00.000Z',
      ends_at: '2026-08-10T19:00:00.000Z',
    }),
    makeShift({
      id: 'cancelled-1',
      status: 'cancelled',
      starts_at: '2026-08-10T08:00:00.000Z',
      ends_at: '2026-08-10T12:00:00.000Z',
    }),
    makeShift({
      id: 'cancelled-2',
      status: 'cancelled',
      starts_at: '2026-08-10T13:00:00.000Z',
      ends_at: '2026-08-10T17:00:00.000Z',
    }),
    makeShift({
      id: 'confirmed-1122',
      status: 'confirmed',
      starts_at: '2026-08-10T10:22:00.000Z',
      ends_at: '2026-08-10T18:22:00.000Z',
    }),
  ];
}

let TodayCoverage: typeof import('../components/TodayCoverage').TodayCoverage;
let mockWeekEntries: ReturnType<typeof mock>;
let mockShiftsRange: ReturnType<typeof mock>;
let mockHouseholdMembers: ReturnType<typeof mock>;
let mockCommitments: ReturnType<typeof mock>;
let mockClosures: ReturnType<typeof mock>;
let mockCreateParentCover: ReturnType<typeof mock>;

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

  mockWeekEntries = mock(() => ({ data: [], isLoading: false }));
  mockShiftsRange = mock(() => ({ data: aug10Shifts(), isLoading: false }));
  mockHouseholdMembers = mock(() => ({
    data: [
      {
        user_id: NANNY_ID,
        profile_name: 'H1 Nanny1',
        display_name_override: null,
        role: 'carer',
      },
    ],
    isLoading: false,
  }));
  mockCommitments = mock(() => ({
    data: [makeCommitment()],
    isLoading: false,
  }));
  mockClosures = mock(() => ({ data: [], isLoading: false }));
  mockCreateParentCover = mock(() => ({
    isPending: false,
    mutateAsync: mock(() => Promise.resolve({})),
  }));

  mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
    useWeekTimeEntries: mockWeekEntries,
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockShiftsRange,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockHouseholdMembers,
  }));
  mock.module('@/src/hooks/queries/useHouseholdCommitments', () => ({
    useHouseholdCommitments: mockCommitments,
  }));
  mock.module('@/src/hooks/queries/useHouseholdClosures', () => ({
    useHouseholdClosures: mockClosures,
  }));
  mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
    useCreateParentCover: () => mockCreateParentCover(),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockHouseholdMembers,
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

/** The typography factory layers `[baseStyle, weight, tabular, caller]`. */
function mergedStyle(style: unknown): Record<string, unknown> {
  const layers = Array.isArray(style) ? style.flat() : [style];
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer && typeof layer === 'object') Object.assign(merged, layer);
  }
  return merged;
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

describe('TodayCoverage — 10 Aug 2026 gap + plan', () => {
  it('SANITY: computeUncoveredToday finds the 09:00–11:22 gap', () => {
    const state = computeUncoveredToday({
      localDate: LOCAL_DATE,
      timezone: ZONE,
      commitments: [makeCommitment()],
      shifts: aug10Shifts(),
      closures: [],
    });
    expect(state.status).toBe('uncovered');
    if (state.status !== 'uncovered') return;
    expect(state.windows).toHaveLength(1);
    const gapStart = formatClockTime(state.windows[0]?.startsAt ?? '', ZONE);
    const gapEnd = formatClockTime(state.windows[0]?.endsAt ?? '', ZONE);
    expect(gapStart).toMatch(/9:00/i);
    expect(gapEnd).toMatch(/11:22/i);
  });

  it('renders gap headline above the plan line with no reassurance copy', () => {
    const uncovered = computeUncoveredToday({
      localDate: LOCAL_DATE,
      timezone: ZONE,
      commitments: [makeCommitment()],
      shifts: aug10Shifts(),
      closures: [],
    });
    if (uncovered.status !== 'uncovered') {
      throw new Error('expected uncovered fixture');
    }
    const gap = uncovered.windows[0];
    if (!gap) throw new Error('expected gap window');

    const tree = renderWithProviders(
      <TodayCoverage
        householdId={HOUSEHOLD_ID}
        timeZone={ZONE}
        weekStartsOn={1}
        householdChildren={[{ id: CHILD_ID, name: 'H1 Child1' } as never]}
      />
    );

    const rendered = serializeTree(tree.toJSON());
    for (const pattern of REASSURANCE_PATTERNS) {
      expect(rendered).not.toMatch(pattern);
    }
    expect(rendered).not.toContain(i18n.t('schedule:cover.allCovered'));

    const headline = tree.getByTestId('today-coverage-gap-headline');
    expect(String(headline.props.children)).toBe(
      i18n.t('today:coverage.gap.titleOne', {
        childName: 'H1 Child1',
        start: formatClockTime(gap.startsAt, ZONE),
        end: formatClockTime(gap.endsAt, ZONE),
      })
    );
    expect(rendered).toMatch(/H1 Nanny1/i);
    expect(rendered).toMatch(/11:22/i);
    tree.getByTestId('today-coverage-plan-confirmed-1122');

    expect(testIdIndex(tree, 'today-coverage-gap-headline')).toBeLessThan(
      testIdIndex(tree, 'today-coverage-plan-confirmed-1122')
    );
  });

  // Daylight v2's single largest fix: this sentence was `Body weight="medium"`
  // (16/24/500) — SMALLER than the handoff card's H4 title below it, on a
  // ground 4% off white. "A title is never smaller than the title of a less
  // important card" (docs/design/01-LAWS.md), so it is an H3. There is no demoted
  // rung any more: a parent's `uncoveredCare` can only ever lose Today's slot
  // to nanny-only rungs, so when this card renders a gap it renders promoted.
  // Sizes, not class names, because the typography factory emits size inline.
  it('sets the gap headline at H3 — the only look it has', () => {
    const atL1 = renderWithProviders(
      <TodayCoverage
        householdId={HOUSEHOLD_ID}
        timeZone={ZONE}
        weekStartsOn={1}
        householdChildren={[{ id: CHILD_ID, name: 'H1 Child1' } as never]}
      />
    );
    expect(
      mergedStyle(atL1.getByTestId('today-coverage-gap-headline').props.style)
        .fontSize
    ).toBe(20);
  });

  // The handoff chips fold in here on the parent side (#9's merge), so the
  // card has to have a bottom to fold them into — under the plan lines, not
  // between the gap card and them.
  it('renders a footer beneath the plan lines', () => {
    const tree = renderWithProviders(
      <TodayCoverage
        householdId={HOUSEHOLD_ID}
        timeZone={ZONE}
        weekStartsOn={1}
        householdChildren={[{ id: CHILD_ID, name: 'H1 Child1' } as never]}
        footer={<View testID="coverage-footer" />}
      />
    );

    expect(tree.getByTestId('coverage-footer')).toBeTruthy();
    expect(
      testIdIndex(tree, 'today-coverage-plan-confirmed-1122')
    ).toBeLessThan(testIdIndex(tree, 'coverage-footer'));
  });

  // Today, left to right, as who has it: the 09:00–11:22 hole and the
  // confirmed 11:22 shift, in that order. The plan lines say the same thing
  // in words — the bar says it in one glance.
  it('renders the day bar with a gap segment and a nanny segment', () => {
    const tree = renderWithProviders(
      <TodayCoverage
        householdId={HOUSEHOLD_ID}
        timeZone={ZONE}
        weekStartsOn={1}
        householdChildren={[{ id: CHILD_ID, name: 'H1 Child1' } as never]}
      />
    );

    expect(tree.getByTestId('today-coverage-day-bar')).toBeTruthy();
    expect(tree.getByTestId('today-coverage-day-bar-gap-0')).toBeTruthy();
    expect(tree.getByTestId('today-coverage-day-bar-nanny-1')).toBeTruthy();
  });

  // The mechanic itself is gone, not just unused — one slot, one occupant.
  it('SOURCE: carries no `demoted` prop or branch any more', async () => {
    const source = await Bun.file(
      join(__dirname, '../components/TodayCoverage.tsx')
    ).text();
    expect(source).not.toContain('demoted');
  });
});
