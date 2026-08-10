/**
 * @module domains/today/__tests__/TodayCoverage.runningLate.test
 *
 * Parent plan line for running-late events, and parent_cover quiet state.
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
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { render } from '@testing-library/react-native';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import i18n from '@/src/i18n';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const PARENT_ID = '44444444-4444-4444-8444-444444444444';
const ZONE = 'Europe/London';
const LOCAL_DATE = '2026-08-10';
const PINNED_NOW = new Date('2026-08-10T12:00:00.000Z');

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

function parentCoverShift(): Shift {
  return makeShift({
    id: 'parent-cover-1',
    carer_id: null,
    kind: SHIFT_KINDS.PARENT_COVER,
    status: 'confirmed',
    starts_at: '2026-08-10T08:00:00.000Z',
    ends_at: '2026-08-10T10:22:00.000Z',
    created_by: PARENT_ID,
    ical_uid: 'uid-parent-cover',
    shift_children: [
      {
        id: 'sc-pc',
        shift_id: 'parent-cover-1',
        child_id: CHILD_ID,
        starts_at: '2026-08-10T08:00:00.000Z',
        ends_at: '2026-08-10T10:22:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
}

let TodayCoverage: typeof import('../components/TodayCoverage').TodayCoverage;
let mockWeekEntries: ReturnType<typeof mock>;
let mockShiftsRange: ReturnType<typeof mock>;
let mockHouseholdMembers: ReturnType<typeof mock>;
let mockCommitments: ReturnType<typeof mock>;
let mockClosures: ReturnType<typeof mock>;
let mockCreateParentCover: ReturnType<typeof mock>;
let mockDayThread: ReturnType<typeof mock>;

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
  mockShiftsRange = mock(() => ({
    data: [makeShift()],
    isLoading: false,
  }));
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
  mockDayThread = mock(() => ({ data: [], isLoading: false }));

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
  mock.module('@/src/hooks/queries/useDayThread', () => ({
    useDayThread: mockDayThread,
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [], isLoading: false }),
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock(), back: mock(), replace: mock() }),
  }));

  const mod = await import('../components/TodayCoverage');
  TodayCoverage = mod.TodayCoverage;
});

describe('TodayCoverage — running late plan line', () => {
  it('renders the carer name with no digit-plus-late construction', () => {
    mockDayThread.mockReturnValue({
      data: [
        {
          id: 'evt-1',
          household_id: HOUSEHOLD_ID,
          shift_id: 'shift-1',
          local_date: LOCAL_DATE,
          actor_id: NANNY_ID,
          event_type: 'running_late',
          payload: {},
          created_at: '2026-08-10T11:00:00.000Z',
        },
      ],
      isLoading: false,
    });

    const tree = render(
      <TodayCoverage
        householdId={HOUSEHOLD_ID}
        timeZone={ZONE}
        householdChildren={[{ id: CHILD_ID, name: 'H1 Child1' } as never]}
      />
    );

    const line = tree.getByTestId('today-coverage-running-late-shift-1');
    const text = String(line.props.children);
    expect(text).toBe(
      i18n.t('today:coverage.plan.runningLate', { name: 'H1' })
    );
    expect(text).toMatch(/H1/);
    expect(text).not.toMatch(/\d+\s*(min|minute)/i);
    expect(text).not.toMatch(/\d+\s*late/i);
  });
});

describe('TodayCoverage — parent cover quiet state', () => {
  it('shows youCovering and stays on screen when parent covers the gap', () => {
    const pc = parentCoverShift();
    mockShiftsRange.mockReturnValue({
      data: [pc, makeShift()],
      isLoading: false,
    });
    mockCommitments.mockReturnValue({
      data: [makeCommitment()],
      isLoading: false,
    });

    const tree = render(
      <TodayCoverage
        householdId={HOUSEHOLD_ID}
        timeZone={ZONE}
        householdChildren={[{ id: CHILD_ID, name: 'H1 Child1' } as never]}
      />
    );

    tree.getByTestId('today-coverage');
    expect(tree.queryByTestId('today-coverage-gap-card')).toBeNull();

    const youLine = tree.getByTestId('today-coverage-plan-parent-cover-1');
    expect(String(youLine.props.children)).toBe(
      i18n.t('today:coverage.plan.youCovering', {
        start: formatClockTime(pc.starts_at, ZONE),
        end: formatClockTime(pc.ends_at, ZONE),
      })
    );
  });
});
