/**
 * @module domains/schedule/__tests__/AgendaView.uncovered.test
 *
 * Uncovered-row copy: ask buttons must interpolate clock times; cause line
 * names the carer when a cancelled/declined shift overlaps.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import { render } from '@testing-library/react-native';
import { formatShiftTime } from '@/src/domains/schedule/utils/shiftGrouping';
import type { UncoveredWindowDisplay } from '@/src/domains/schedule/utils/uncoveredDisplay';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NANNY_ID = '22222222-2222-4222-8222-222222222222';
const NANNY_B_ID = '33333333-3333-4333-8333-333333333333';
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

function renderUncoveredRow(args: {
  carers: unknown[];
  members: unknown[];
  shifts: Shift[];
  cause?: UncoveredWindowDisplay['cause'];
}) {
  const window = makeUncoveredWindow(args.cause ?? 'cancelled');
  mockUseHouseholdCarers.mockImplementation(() => ({ data: args.carers }));
  mockUseHouseholdMembers.mockImplementation(() => ({ data: args.members }));

  const { getByTestId } = render(
    <AgendaView
      shifts={args.shifts}
      householdId={HOUSEHOLD_ID}
      displayTimeZone={TZ}
      weekDates={[LOCAL_DATE]}
      uncoveredByDay={{ [LOCAL_DATE]: [window] }}
      showUncoveredActions
    />
  );

  return {
    getByTestId,
    window,
    formattedStart: formatShiftTime(WINDOW_START, TZ, 'en-US'),
    formattedEnd: formatShiftTime(WINDOW_END, TZ, 'en-US'),
  };
}

describe('AgendaView uncovered row copy', () => {
  it('askToCover interpolates start — never literal {{start}}', () => {
    const { getByTestId, window, formattedStart } = renderUncoveredRow({
      carers: [nannyMember(NANNY_ID, 'Maria Lopez')],
      members: [nannyMember(NANNY_ID, 'Maria Lopez')],
      shifts: [makeShift()],
    });

    const button = getByTestId(
      `schedule-uncovered-ask-${uncoveredKey(window)}`
    );
    const label = String(button.props.children);
    expect(label).toContain('Maria');
    expect(label).toContain(formattedStart);
    expect(label).not.toContain('{{start}}');
  });

  it('askSomeoneToCover interpolates start and end — never literal {{start}}', () => {
    const { getByTestId, window, formattedStart, formattedEnd } =
      renderUncoveredRow({
        carers: [
          nannyMember(NANNY_ID, 'Maria Lopez'),
          nannyMember(NANNY_B_ID, 'Sam Chen'),
        ],
        members: [
          nannyMember(NANNY_ID, 'Maria Lopez'),
          nannyMember(NANNY_B_ID, 'Sam Chen'),
        ],
        shifts: [makeShift()],
      });

    const button = getByTestId(
      `schedule-uncovered-ask-${uncoveredKey(window)}`
    );
    const label = String(button.props.children);
    expect(label).toContain(formattedStart);
    expect(label).toContain(formattedEnd);
    expect(label).not.toContain('{{start}}');
    expect(label).not.toContain('{{end}}');
  });

  it('cause line names the carer when a cancelled shift overlaps', () => {
    const { getByTestId, window, formattedStart, formattedEnd } =
      renderUncoveredRow({
        carers: [nannyMember(NANNY_ID, 'Maria Lopez')],
        members: [nannyMember(NANNY_ID, 'Maria Lopez')],
        shifts: [makeShift()],
      });

    const row = getByTestId(`schedule-uncovered-${uncoveredKey(window)}`);
    const meta = String(row.props.children[0].props.children[1].props.children);
    expect(meta).toContain('Maria Lopez');
    expect(meta).toContain(formattedStart);
    expect(meta).toContain(formattedEnd);
    expect(meta).not.toContain('A shift was cancelled');
  });

  it('cause line falls back to generic copy when carer is unresolvable', () => {
    const { getByTestId, window } = renderUncoveredRow({
      carers: [nannyMember(NANNY_ID, 'Maria Lopez')],
      members: [],
      shifts: [makeShift({ carer_id: 'unknown-carer-id' })],
    });

    const row = getByTestId(`schedule-uncovered-${uncoveredKey(window)}`);
    const meta = String(row.props.children[0].props.children[1].props.children);
    expect(meta).toContain('A shift was cancelled');
    expect(meta).not.toContain('undefined');
    expect(meta).not.toContain('Someone');
  });
});
