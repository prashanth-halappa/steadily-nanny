/**
 * @module domains/schedule/__tests__/AgendaView.awaiting.test
 *
 * Awaiting windows (an unanswered ask): a pending pattern's window reads
 * "Pending" with no ask/cover buttons; a one-off pending shift's window adds
 * no second row next to the shift row that already says Pending.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import { render } from '@testing-library/react-native';
import type { UncoveredWindowDisplay } from '@/src/domains/schedule/utils/uncoveredDisplay';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NANNY_ID = '22222222-2222-4222-8222-222222222222';
const LOCAL_DATE = '2026-08-03';
const TZ = 'America/New_York';
const WINDOW_START = '2026-08-03T13:00:00.000Z';
const WINDOW_END = '2026-08-03T17:00:00.000Z';

const scheduleEn = JSON.parse(
  readFileSync(
    join(import.meta.dir, '../../../i18n/locales/en/schedule.json'),
    'utf8'
  )
) as Record<string, unknown>;

function getNested(obj: Record<string, unknown>, path: string): string {
  const value = path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
  return typeof value === 'string' ? value : path;
}

function interpolate(template: string, vars?: Record<string, unknown>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(vars[key] ?? `{{${key}}}`)
  );
}

const mockUseHouseholdMembers = mock((): { data: unknown[] } => ({ data: [] }));
const mockUseHouseholdCarers = mock((): { data: unknown[] } => ({ data: [] }));

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: (ns?: string) => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        if (ns === 'today') {
          return key;
        }
        return interpolate(getNested(scheduleEn, key), vars);
      },
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: () => {} }),
    router: { push: () => {}, replace: () => {}, back: () => {} },
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({
      data: [{ id: CHILD_ID, name: 'Mia' }],
      isLoading: false,
    }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: mockUseHouseholdCarers,
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
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
});

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

function nannyMember(userId: string, displayName: string) {
  return {
    id: `member-${userId}`,
    household_id: HOUSEHOLD_ID,
    user_id: userId,
    role: 'nanny' as const,
    can_edit: false,
    status: 'active' as const,
    display_name_override: displayName,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function makeUncoveredWindow(
  cause: UncoveredWindowDisplay['cause']
): UncoveredWindowDisplay {
  return {
    childId: CHILD_ID,
    commitmentId: COMMITMENT_ID,
    startsAt: WINDOW_START,
    endsAt: WINDOW_END,
    cause,
  };
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-cancelled',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
    starts_at: WINDOW_START,
    ends_at: WINDOW_END,
    timezone: TZ,
    local_date: LOCAL_DATE,
    kind: 'recurring',
    status: 'cancelled',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift-cancelled@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    shift_children: [],
    ...overrides,
  } as Shift;
}

function renderAwaiting(shifts: Shift[]) {
  const window = makeUncoveredWindow('nothingScheduled');
  mockUseHouseholdCarers.mockImplementation(() => ({
    data: [nannyMember(NANNY_ID, 'Maria Lopez')],
  }));
  mockUseHouseholdMembers.mockImplementation(() => ({
    data: [nannyMember(NANNY_ID, 'Maria Lopez')],
  }));
  const utils = render(
    <AgendaView
      shifts={shifts}
      householdId={HOUSEHOLD_ID}
      displayTimeZone={TZ}
      weekDates={[LOCAL_DATE]}
      uncoveredByDay={{ [LOCAL_DATE]: [] }}
      awaitingByDay={{ [LOCAL_DATE]: [window] }}
      showUncoveredActions
    />
  );
  return { ...utils, key: uncoveredKey(window) };
}

describe('AgendaView awaiting windows', () => {
  it('a pending-pattern window shows the Pending pill and no ask or cover button', () => {
    const { getByTestId, queryByTestId, queryByText, key } = renderAwaiting([]);

    expect(getByTestId(`schedule-awaiting-${key}`)).toBeTruthy();
    expect(
      queryByText(getNested(scheduleEn, 'cover.rowPillPending'))
    ).not.toBeNull();
    expect(queryByText(getNested(scheduleEn, 'cover.rowPill'))).toBeNull();
    expect(queryByTestId(`schedule-uncovered-ask-${key}`)).toBeNull();
    expect(queryByTestId(`schedule-uncovered-cover-${key}`)).toBeNull();
    expect(queryByTestId(`schedule-uncovered-${key}`)).toBeNull();
  });

  it('a one-off pending shift window renders only the shift row', () => {
    const pending = makeShift({
      id: 'shift-pending',
      kind: 'extra',
      status: 'pending',
    });
    const { getByTestId, queryByTestId, key } = renderAwaiting([pending]);

    expect(getByTestId('schedule-shift-shift-pending')).toBeTruthy();
    expect(queryByTestId(`schedule-awaiting-${key}`)).toBeNull();
    expect(queryByTestId(`schedule-uncovered-${key}`)).toBeNull();
  });
});
