/**
 * @module domains/schedule/__tests__/AgendaView.nowLine.test
 *
 * Pattern B (mock rendering, docs/09-TESTING.md §5) — FlashList is globally
 * mocked to a plain non-virtualized list (bun.setup.ts), so AgendaView can
 * be rendered for real here. The now-line is a static "you are here" marker
 * in today's section, computed once per render (same precedent as LiveDot:
 * not a ticking clock).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { render } from '@testing-library/react-native';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
  router: { push: () => {}, replace: () => {}, back: () => {} },
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_A_ID = '22222222-2222-4222-8222-222222222222';

mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
  useHouseholdMembers: () => ({ data: [] }),
}));
mock.module('@/src/hooks/queries/useChildren', () => ({
  useChildren: () => ({ data: [], isLoading: false }),
}));
mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
  useHouseholdCarers: () => ({ data: [], isLoading: false }),
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

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

function todayUtc(): string {
  return localDateInZone('UTC');
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_A_ID,
    starts_at: '2026-08-03T13:00:00.000Z',
    ends_at: '2026-08-03T21:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-08-03',
    kind: 'recurring',
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
    ical_uid: 'shift-1@steadily',
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

function collectTestIds(node: unknown): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (typeof value !== 'object') return;
    const rec = value as {
      props?: { testID?: string; children?: unknown };
      children?: unknown;
    };
    if (typeof rec.props?.testID === 'string') {
      ids.push(rec.props.testID);
    }
    visit(rec.children);
    visit(rec.props?.children);
  };
  visit(node);
  return ids;
}

describe('AgendaView now-line', () => {
  it("renders the now-line inside today's section", () => {
    const today = todayUtc();
    const { getByTestId } = render(
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        weekDates={[today]}
        displayTimeZone="UTC"
        householdTimeZone="UTC"
      />
    );

    expect(getByTestId('schedule-now-line')).toBeTruthy();
    expect(getByTestId(`schedule-day-today-${today}`)).toBeTruthy();
  });

  it('places it after the last shift that has already started and before the next one', () => {
    const today = todayUtc();
    const now = Date.now();
    const { toJSON } = render(
      <AgendaView
        shifts={[
          makeShift({
            id: 'shift-started',
            local_date: today,
            starts_at: new Date(now - 60 * 60 * 1000).toISOString(),
            ends_at: new Date(now - 30 * 60 * 1000).toISOString(),
          }),
          makeShift({
            id: 'shift-upcoming',
            local_date: today,
            starts_at: new Date(now + 60 * 60 * 1000).toISOString(),
            ends_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
          }),
        ]}
        householdId={HOUSEHOLD_ID}
        weekDates={[today]}
        displayTimeZone="UTC"
        householdTimeZone="UTC"
      />
    );

    const ids = collectTestIds(toJSON());
    const nowIdx = ids.indexOf('schedule-now-line');
    const startedIdx = ids.indexOf('schedule-shift-shift-started');
    const upcomingIdx = ids.indexOf('schedule-shift-shift-upcoming');
    expect(nowIdx).toBeGreaterThan(-1);
    expect(startedIdx).toBeGreaterThan(-1);
    expect(upcomingIdx).toBeGreaterThan(-1);
    expect(nowIdx).toBeGreaterThan(startedIdx);
    expect(nowIdx).toBeLessThan(upcomingIdx);
  });

  it('renders no now-line on a week that does not contain today', () => {
    const { queryByTestId } = render(
      <AgendaView
        shifts={[makeShift()]}
        householdId={HOUSEHOLD_ID}
        weekDates={['2020-01-06']}
        displayTimeZone="UTC"
        householdTimeZone="UTC"
      />
    );

    expect(queryByTestId('schedule-now-line')).toBeNull();
  });

  it("places it at the top of today's section when nothing has started yet", () => {
    const today = todayUtc();
    const now = Date.now();
    const { toJSON } = render(
      <AgendaView
        shifts={[
          makeShift({
            id: 'shift-later',
            local_date: today,
            starts_at: new Date(now + 60 * 60 * 1000).toISOString(),
            ends_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
          }),
        ]}
        householdId={HOUSEHOLD_ID}
        weekDates={[today]}
        displayTimeZone="UTC"
        householdTimeZone="UTC"
      />
    );

    const ids = collectTestIds(toJSON());
    const headerIdx = ids.indexOf(`schedule-day-today-${today}`);
    const nowIdx = ids.indexOf('schedule-now-line');
    const shiftIdx = ids.indexOf('schedule-shift-shift-later');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(nowIdx).toBeGreaterThan(headerIdx);
    expect(nowIdx).toBeLessThan(shiftIdx);
  });

  it('renders one now-line at most', () => {
    const today = todayUtc();
    const now = Date.now();
    const weekDates = [
      addLocalDays(today, -2),
      addLocalDays(today, -1),
      today,
      addLocalDays(today, 1),
      addLocalDays(today, 2),
    ];
    const { getAllByTestId } = render(
      <AgendaView
        shifts={weekDates.map((localDate, index) =>
          makeShift({
            id: `shift-day-${index}`,
            local_date: localDate,
            starts_at: new Date(
              now + (index - 2) * 60 * 60 * 1000
            ).toISOString(),
            ends_at: new Date(
              now + (index - 2) * 60 * 60 * 1000 + 60 * 60 * 1000
            ).toISOString(),
          })
        )}
        householdId={HOUSEHOLD_ID}
        weekDates={weekDates}
        displayTimeZone="UTC"
        householdTimeZone="UTC"
      />
    );

    expect(getAllByTestId('schedule-now-line')).toHaveLength(1);
  });
});
