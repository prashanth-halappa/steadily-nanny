/**
 * @module domains/schedule/__tests__/WeekRibbonView.split.test
 *
 * Spec addendum A2: an hour that is itself partly covered (need 7:00–9:00,
 * shift 8:30–9:00) splits into minute-sized segments instead of letting
 * uncovered paint the whole cell and hide the booked half.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const pushed: string[] = [];
mock.module('expo-router', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));

const WEEK_DATES = [
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-08',
  '2026-08-09',
];
const MONDAY = 1;
const DAY = '2026-08-03';
const iso = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    starts_at: iso('08:30'),
    ends_at: iso('09:00'),
    timezone: 'UTC',
    local_date: DAY,
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

const need = (start: string, end: string): UncoveredWindow => ({
  childId: 'child-1',
  commitmentId: 'commitment-1',
  startsAt: iso(start),
  endsAt: iso(end),
});

let WeekRibbonView: typeof import('../components/WeekRibbonView').WeekRibbonView;

beforeAll(async () => {
  WeekRibbonView = (await import('../components/WeekRibbonView'))
    .WeekRibbonView;
});

beforeEach(() => {
  pushed.length = 0;
});

function renderGrid(props: {
  shifts?: Shift[];
  uncovered?: UncoveredWindow[];
  awaiting?: UncoveredWindow[];
}) {
  return render(
    <WeekRibbonView
      shifts={props.shifts ?? []}
      displayTimeZone="UTC"
      weekDates={WEEK_DATES}
      householdTimeZone="UTC"
      uncoveredByDay={props.uncovered ? { [DAY]: props.uncovered } : {}}
      awaitingByDay={props.awaiting ? { [DAY]: props.awaiting } : {}}
    />
  );
}

const seg = (utils: ReturnType<typeof renderGrid>, hour: number, i: number) =>
  StyleSheet.flatten(
    utils.getByTestId(`week-ribbon-cell-${MONDAY}-${hour}-seg-${i}`).props.style
  );

describe('WeekRibbonView split cells (addendum A2)', () => {
  it('need 7–9 with a confirmed shift 8:30–9:00 splits 8:00 into uncovered then confirmed', () => {
    const utils = renderGrid({
      shifts: [makeShift()],
      uncovered: [need('07:00', '08:30')],
    });

    const cell = utils.getByTestId(`week-ribbon-cell-${MONDAY}-8`);
    expect(cell.props.accessibilityLabel).toBe('uncovered+confirmed');
    const cellStyle = StyleSheet.flatten(cell.props.style);
    expect(cellStyle.flexDirection).toBe('row');
    expect(cellStyle.height).toBe(16);
    expect(cellStyle.gap).toBe(1);

    const first = seg(utils, 8, 0);
    expect(first.backgroundColor).toBe('#9C6E2E'); // warningStrong
    expect(first.flex).toBe(30);
    expect(first.minWidth).toBe(6);
    expect(first.borderRadius).toBe(8);
    const second = seg(utils, 8, 1);
    expect(second.backgroundColor).toBe('#5B3E5D'); // primary
    expect(second.flex).toBe(30);
    expect(
      utils.queryByTestId(`week-ribbon-cell-${MONDAY}-8-seg-2`)
    ).toBeNull();

    // The whole-hour 7:00 cell is unchanged.
    expect(
      utils.getByTestId(`week-ribbon-cell-${MONDAY}-7`).props.accessibilityLabel
    ).toBe('uncovered');
    expect(
      utils.queryByTestId(`week-ribbon-cell-${MONDAY}-7-seg-0`)
    ).toBeNull();
  });

  it('uncovered wins over an overlapping shift within the same minutes', () => {
    // Uncovered computation may still overlap a shift (it is S1-safe to
    // let it): the overlap minutes go to uncovered.
    const utils = renderGrid({
      shifts: [makeShift()],
      uncovered: [need('07:00', '08:40')],
    });
    expect(
      utils.getByTestId(`week-ribbon-cell-${MONDAY}-8`).props.accessibilityLabel
    ).toBe('uncovered+confirmed');
    expect(seg(utils, 8, 0).flex).toBe(40);
    expect(seg(utils, 8, 1).flex).toBe(20);
  });

  it('a pending ask over 8:30–9:00 splits 8:00 into uncovered then pending', () => {
    const utils = renderGrid({
      uncovered: [need('07:00', '08:30')],
      awaiting: [need('08:30', '09:00')],
    });
    expect(
      utils.getByTestId(`week-ribbon-cell-${MONDAY}-8`).props.accessibilityLabel
    ).toBe('uncovered+pending');
    const second = seg(utils, 8, 1);
    expect(second.borderStyle).toBe('dashed');
    expect(second.backgroundColor).toBe('transparent');
    expect(second.flex).toBe(30);
  });

  it('a pending shift over 8:30–9:00 also reads uncovered+pending', () => {
    const utils = renderGrid({
      shifts: [makeShift({ status: 'pending' })],
      uncovered: [need('07:00', '08:30')],
    });
    expect(
      utils.getByTestId(`week-ribbon-cell-${MONDAY}-8`).props.accessibilityLabel
    ).toBe('uncovered+pending');
  });

  it('unoccupied minutes inside a split hour are a transparent segment', () => {
    const utils = renderGrid({
      shifts: [makeShift({ starts_at: iso('08:40') })],
      uncovered: [need('07:00', '08:20')],
    });
    expect(
      utils.getByTestId(`week-ribbon-cell-${MONDAY}-8`).props.accessibilityLabel
    ).toBe('uncovered+confirmed');
    expect(seg(utils, 8, 0).flex).toBe(20);
    const gap = seg(utils, 8, 1);
    expect(gap.flex).toBe(20);
    expect(gap.backgroundColor).toBe('transparent');
    expect(gap.borderWidth).toBe(0);
    expect(seg(utils, 8, 2).flex).toBe(20);
  });

  it('a cancelled shift counts as empty inside a split', () => {
    const utils = renderGrid({
      shifts: [
        makeShift({ id: 'c', status: 'cancelled', starts_at: iso('08:00') }),
        makeShift({ id: 'p', status: 'pending', starts_at: iso('08:30') }),
      ],
      uncovered: [need('07:00', '08:15')],
    });
    expect(
      utils.getByTestId(`week-ribbon-cell-${MONDAY}-8`).props.accessibilityLabel
    ).toBe('uncovered+pending');
    expect(seg(utils, 8, 0).flex).toBe(15);
    expect(seg(utils, 8, 1).backgroundColor).toBe('transparent');
    expect(seg(utils, 8, 1).flex).toBe(15);
    expect(seg(utils, 8, 2).flex).toBe(30);
  });

  it('a single-kind hour (shift 7:30–9:00, no need) does not split', () => {
    const utils = renderGrid({
      shifts: [makeShift({ starts_at: iso('07:30') })],
    });
    const cell = utils.getByTestId(`week-ribbon-cell-${MONDAY}-7`);
    expect(cell.props.accessibilityLabel).toBe('confirmed');
    expect(
      utils.queryByTestId(`week-ribbon-cell-${MONDAY}-7-seg-0`)
    ).toBeNull();
    const style = StyleSheet.flatten(cell.props.style);
    expect(style.backgroundColor).toBe('#5B3E5D');
    expect(style.height).toBe(16);
    expect(style.flexDirection).toBeUndefined();
  });

  it('a split cell with exactly one shift routes to that shift', () => {
    const utils = renderGrid({
      shifts: [makeShift({ id: 'booked' })],
      uncovered: [need('07:00', '08:30')],
    });
    fireEvent.press(utils.getByTestId(`week-ribbon-press-${MONDAY}-8`));
    expect(pushed).toEqual(['/(private)/schedule/shifts/booked']);
  });

  it('a split cell with no shift (uncovered + awaiting) is non-navigating', () => {
    const utils = renderGrid({
      uncovered: [need('07:00', '08:30')],
      awaiting: [need('08:30', '09:00')],
    });
    expect(utils.queryByTestId(`week-ribbon-press-${MONDAY}-8`)).toBeNull();
  });

  it('a split cell with two shifts is non-navigating', () => {
    const utils = renderGrid({
      shifts: [
        makeShift({ id: 'a', starts_at: iso('08:00'), ends_at: iso('08:20') }),
        makeShift({ id: 'b', status: 'pending', starts_at: iso('08:40') }),
      ],
    });
    expect(
      utils.getByTestId(`week-ribbon-cell-${MONDAY}-8`).props.accessibilityLabel
    ).toBe('confirmed+pending');
    expect(utils.queryByTestId(`week-ribbon-press-${MONDAY}-8`)).toBeNull();
  });
});
