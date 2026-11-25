/**
 * @module domains/schedule/__tests__/AgendaView.pages.test
 *
 * The continuous Agenda: `weeks` turns the list into a run of week pages.
 * Each page owns its own state — a page still loading or failed never reads
 * as "nothing on" (CLAUDE.md, "Ungated queries stating facts"); a loaded
 * page with nothing at all collapses to one separator instead of seven bare
 * days; the screen's header rides as an item directly above the anchor week
 * so past pages can load above it.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { localDateInZone } from '@/src/lib/localDate';
import type { AgendaWeek } from '../components/AgendaView';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const TZ = 'America/New_York';
const PAST = '2026-07-27';
const ANCHOR = '2026-08-03';
const NEXT = '2026-08-10';

function weekDates(start: string): string[] {
  const [y, m, d] = start.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + i))
      .toISOString()
      .slice(0, 10)
  );
}

function week(start: string, overrides: Partial<AgendaWeek> = {}): AgendaWeek {
  return {
    weekStart: start,
    dates: weekDates(start),
    status: 'ready',
    ...overrides,
  };
}

beforeAll(() => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: () => {} }),
    router: { push: () => {}, replace: () => {}, back: () => {} },
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: [] }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [] }),
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

function makeShift(id: string, localDate: string): Shift {
  return {
    id,
    household_id: HOUSEHOLD_ID,
    carer_id: null,
    starts_at: `${localDate}T13:00:00.000Z`,
    ends_at: `${localDate}T21:00:00.000Z`,
    timezone: TZ,
    local_date: localDate,
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
    ical_uid: `${id}@steadily`,
    sequence: 0,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    shift_children: [],
  } as Shift;
}

function renderPages(
  weeks: AgendaWeek[],
  shifts: Shift[],
  extra: { onLoadLater?: () => void } = {}
) {
  return render(
    <AgendaView
      shifts={shifts}
      householdId={HOUSEHOLD_ID}
      displayTimeZone={TZ}
      householdTimeZone={TZ}
      weeks={weeks}
      heroWeekStart={ANCHOR}
      listHeader={<Text testID="hero">hero</Text>}
      onLoadLater={extra.onLoadLater}
    />
  );
}

type ListProps = {
  data: { key: string }[];
  initialScrollIndex?: number;
  onStartReached?: () => void;
  onScrollBeginDrag?: () => void;
};
function listProps(utils: ReturnType<typeof render>): ListProps {
  return utils.UNSAFE_root.findAll(
    node => Array.isArray(node.props.data) && 'getItemType' in node.props
  )[0]?.props as ListProps;
}

/** Document order of the given testIDs in the rendered tree. */
function orderOf(json: unknown, ids: string[]): string[] {
  const text = JSON.stringify(json);
  return [...ids].sort(
    (a, b) => text.indexOf(`"${a}"`) - text.indexOf(`"${b}"`)
  );
}

describe('AgendaView week pages', () => {
  it('renders every loaded week in date order; with nothing from today on, the NOW block falls in after the anchor week', () => {
    const shifts = [
      makeShift('s-past', '2026-07-29'),
      makeShift('s-anchor', '2026-08-04'),
      makeShift('s-next', '2026-08-12'),
    ];
    const utils = renderPages([week(PAST), week(ANCHOR), week(NEXT)], shifts);

    // Every date here is in the past, so no day is >= today: the fallback
    // puts the NOW block right after the anchor (current) week.
    const ids = [
      'schedule-shift-s-past',
      `schedule-day-${ANCHOR}`,
      'schedule-shift-s-anchor',
      'hero',
      'schedule-shift-s-next',
    ];
    for (const id of ids) {
      expect(utils.getByTestId(id)).toBeTruthy();
    }
    expect(orderOf(utils.toJSON(), ids)).toEqual(ids);
    // A week with something on keeps its seven day headers, as before.
    for (const date of weekDates(NEXT)) {
      expect(utils.getByTestId(`schedule-day-${date}`)).toBeTruthy();
    }
  });

  it('a loaded week with nothing at all collapses to one separator, not seven bare days', () => {
    const utils = renderPages(
      [week(ANCHOR), week(NEXT)],
      [makeShift('s-anchor', '2026-08-04')]
    );

    expect(
      utils.getByTestId(`schedule-agenda-week-empty-${NEXT}`)
    ).toBeTruthy();
    expect(utils.queryByTestId(`schedule-day-${NEXT}`)).toBeNull();
  });

  it('a week still loading shows a spinner, never the empty separator or its days', () => {
    const utils = renderPages(
      [week(ANCHOR), week(NEXT, { status: 'loading' })],
      [makeShift('s-anchor', '2026-08-04')]
    );

    expect(
      utils.getByTestId(`schedule-agenda-week-loading-${NEXT}`)
    ).toBeTruthy();
    expect(
      utils.queryByTestId(`schedule-agenda-week-empty-${NEXT}`)
    ).toBeNull();
    expect(utils.queryByTestId(`schedule-day-${NEXT}`)).toBeNull();
  });

  it('a failed week offers its own retry, never the empty separator', () => {
    const onRetry = mock();
    const utils = renderPages(
      [week(ANCHOR), week(NEXT, { status: 'error', onRetry })],
      [makeShift('s-anchor', '2026-08-04')]
    );

    expect(
      utils.queryByTestId(`schedule-agenda-week-empty-${NEXT}`)
    ).toBeNull();
    fireEvent.press(
      utils.getByTestId(`schedule-agenda-week-error-${NEXT}-button`)
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers the next week at the foot of the list when more can load', () => {
    const onLoadLater = mock();
    const utils = renderPages(
      [week(ANCHOR)],
      [makeShift('s-anchor', '2026-08-04')],
      { onLoadLater }
    );

    fireEvent.press(utils.getByTestId('schedule-agenda-load-later'));
    expect(onLoadLater).toHaveBeenCalledTimes(1);
  });

  it('no foot button while the last week is still loading, or when nothing more can load', () => {
    const loading = renderPages(
      [week(ANCHOR), week(NEXT, { status: 'loading' })],
      [],
      { onLoadLater: mock() }
    );
    expect(loading.queryByTestId('schedule-agenda-load-later')).toBeNull();
    loading.unmount();

    const capped = renderPages([week(ANCHOR)], [makeShift('s', '2026-08-04')]);
    expect(capped.queryByTestId('schedule-agenda-load-later')).toBeNull();
  });

  it('NOW block sits directly above the first day from today on, under its week divider', () => {
    const today = localDateInZone(TZ);
    const thisWeek = getWeekStartISO(new Date(), TZ, 1);
    const utils = render(
      <AgendaView
        shifts={[makeShift('s-now', today)]}
        householdId={HOUSEHOLD_ID}
        displayTimeZone={TZ}
        householdTimeZone={TZ}
        weeks={[week(thisWeek)]}
        heroWeekStart={thisWeek}
        listHeader={<Text testID="hero">hero</Text>}
      />
    );
    const ids = [
      `schedule-agenda-week-label-${thisWeek}`,
      'schedule-agenda-now',
      `schedule-day-${today}`,
    ];
    for (const id of ids) {
      expect(utils.getByTestId(id)).toBeTruthy();
    }
    expect(orderOf(utils.toJSON(), ids)).toEqual(ids);
    if (today !== thisWeek) {
      // The week's past days stay above the NOW block.
      expect(
        orderOf(utils.toJSON(), [
          `schedule-day-${thisWeek}`,
          'schedule-agenda-now',
        ])
      ).toEqual([`schedule-day-${thisWeek}`, 'schedule-agenda-now']);
    }
  });

  it('a week divider opens every filled week; an empty or unloaded week keeps its single line instead', () => {
    const utils = renderPages(
      [week(PAST, { status: 'loading' }), week(ANCHOR), week(NEXT)],
      [makeShift('s-anchor', '2026-08-04')]
    );
    expect(
      utils.getByTestId(`schedule-agenda-week-label-${ANCHOR}`)
    ).toBeTruthy();
    expect(
      utils.queryByTestId(`schedule-agenda-week-label-${NEXT}`)
    ).toBeNull();
    expect(
      utils.queryByTestId(`schedule-agenda-week-label-${PAST}`)
    ).toBeNull();
  });

  it('opens on the NOW block (initialScrollIndex), and loads no earlier week until the reader drags', () => {
    const onLoadEarlier = mock();
    const utils = render(
      <AgendaView
        shifts={[makeShift('s-anchor', '2026-08-04')]}
        householdId={HOUSEHOLD_ID}
        displayTimeZone={TZ}
        householdTimeZone={TZ}
        weeks={[week(ANCHOR)]}
        heroWeekStart={ANCHOR}
        listHeader={<Text testID="hero">hero</Text>}
        onLoadEarlier={onLoadEarlier}
      />
    );
    const props = listProps(utils);
    expect(props.data[props.initialScrollIndex ?? -1]?.key).toBe('hero');
    // FlashList can fire onStartReached during mount, before the initial
    // offset settles — so it isn't wired until a real drag.
    expect(props.onStartReached).toBeUndefined();
    act(() => {
      props.onScrollBeginDrag?.();
    });
    expect(listProps(utils).onStartReached).toBe(onLoadEarlier);
  });

  it('"Today" (nowRequest) scrolls back to the NOW block, animated', () => {
    const scrollToIndex = mock();
    const listRef = { current: { scrollToIndex } } as never;
    const view = (nowRequest: number) => (
      <AgendaView
        shifts={[makeShift('s-anchor', '2026-08-04')]}
        householdId={HOUSEHOLD_ID}
        displayTimeZone={TZ}
        householdTimeZone={TZ}
        weeks={[week(ANCHOR)]}
        heroWeekStart={ANCHOR}
        listHeader={<Text testID="hero">hero</Text>}
        listRef={listRef}
        nowRequest={nowRequest}
      />
    );
    const utils = render(view(0));
    expect(scrollToIndex).not.toHaveBeenCalled();
    utils.rerender(view(1));
    const index = listProps(utils).data.findIndex(item => item.key === 'hero');
    expect(scrollToIndex).toHaveBeenCalledWith({ index, animated: true });
  });

  it('a deep-link focus jumps to its gap once: page loads do not re-jump', () => {
    const window = {
      childId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      commitmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      startsAt: '2026-08-04T13:00:00.000Z',
      endsAt: '2026-08-04T17:00:00.000Z',
      cause: 'nothingScheduled' as const,
    };
    const key = `${window.childId}|${window.commitmentId}|${window.startsAt}|${window.endsAt}`;
    const scrollToIndex = mock();
    const listRef = { current: { scrollToIndex } } as never;
    const view = (weeks: AgendaWeek[]) => (
      <AgendaView
        shifts={[]}
        householdId={HOUSEHOLD_ID}
        displayTimeZone={TZ}
        householdTimeZone={TZ}
        weeks={weeks}
        heroWeekStart={ANCHOR}
        uncoveredByDay={{ '2026-08-04': [window] }}
        focusUncoveredKey={key}
        listRef={listRef}
      />
    );

    const utils = render(view([week(ANCHOR)]));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    utils.rerender(view([week(ANCHOR), week(NEXT, { status: 'loading' })]));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
  });
});
