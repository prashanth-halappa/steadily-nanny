/**
 * @module domains/schedule/__tests__/WeekRibbonView.render.test
 *
 * Pattern B (mock rendering, docs/09-TESTING.md §5) — the away band actually
 * reaches the screen.
 *
 * Why this exists as a render test: the sibling `WeekRibbonView.test.ts`
 * checks the component by reading its source, which cannot tell a rendered
 * away band from an unreachable one. Week is a PERSISTED calendar preference
 * (`calendarViewStore`), so a parent who once chose it would silently never
 * learn their carer is away.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

mock.module('expo-router', () => ({
  useRouter: () => ({ push: () => {} }),
}));

// Monday 3 Aug 2026 – Sunday 9 Aug 2026, the week in the parent screenshots.
const WEEK_DATES = [
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-08',
  '2026-08-09',
];
/** `localDateToWeekday` is `Date.getDay()`: 0 = Sunday, so Wednesday is 3. */
const WEDNESDAY_DOW = 3;
const MONDAY_DOW = 1;

const timeOffOn = (
  startsAt: string,
  endsAt: string,
  status: CarerTimeOff['status'] = 'confirmed'
) => ({ starts_at: startsAt, ends_at: endsAt, status }) as CarerTimeOff;

let WeekRibbonView: typeof import('../components/WeekRibbonView').WeekRibbonView;

beforeAll(async () => {
  WeekRibbonView = (await import('../components/WeekRibbonView'))
    .WeekRibbonView;
});

describe('WeekRibbonView away band', () => {
  it('marks the weekday a carer is away, and only that weekday', () => {
    const { queryByTestId } = render(
      <WeekRibbonView
        shifts={[]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
        timeOff={[
          timeOffOn('2026-08-05T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
        ]}
      />
    );

    expect(queryByTestId(`week-ribbon-away-${WEDNESDAY_DOW}`)).not.toBeNull();
    expect(queryByTestId(`week-ribbon-away-${MONDAY_DOW}`)).toBeNull();
  });

  it('marks nothing when the household has no time off', () => {
    const { queryByTestId } = render(
      <WeekRibbonView
        shifts={[]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
        timeOff={[]}
      />
    );

    expect(queryByTestId(`week-ribbon-away-${WEDNESDAY_DOW}`)).toBeNull();
  });

  it('ignores a cancelled time-off row', () => {
    // Cancelled leave is still on the wire; painting it would tell a parent
    // nobody is coming on a day the carer is in fact working.
    const { queryByTestId } = render(
      <WeekRibbonView
        shifts={[]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
        timeOff={[
          timeOffOn(
            '2026-08-05T00:00:00.000Z',
            '2026-08-06T00:00:00.000Z',
            'cancelled'
          ),
        ]}
      />
    );

    expect(queryByTestId(`week-ribbon-away-${WEDNESDAY_DOW}`)).toBeNull();
  });
});

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    starts_at: '2026-08-03T09:00:00.000Z',
    ends_at: '2026-08-03T10:00:00.000Z',
    timezone: 'Europe/London',
    local_date: '2026-08-03', // Monday
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

function makeUncoveredWindow(
  overrides: Partial<UncoveredWindow> = {}
): UncoveredWindow {
  return {
    childId: 'child-1',
    commitmentId: 'commitment-1',
    startsAt: '2026-08-03T09:00:00.000Z',
    endsAt: '2026-08-03T10:00:00.000Z',
    ...overrides,
  };
}

describe('WeekRibbonView cell tiers (spec §1: shape + hue per state)', () => {
  const cellAt9 = (shift: Shift) => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[shift]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
      />
    );
    return StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.style
    );
  };

  it('cancelled and declined are a gray[500] half-height (8) bar, no border', () => {
    for (const status of ['cancelled', 'declined'] as const) {
      const cell = cellAt9(makeShift({ status }));
      expect(cell.backgroundColor).toBe('#7E7280'); // gray[500]
      expect(cell.height).toBe(8);
      expect(cell.borderWidth).toBe(0);
    }
  });

  it('REGRESSION: parent_cover is a 1.5px solid primary outline over washPlum, not primaryLight', () => {
    const cell = cellAt9(
      makeShift({ kind: 'parent_cover', status: 'confirmed' })
    );
    expect(cell.backgroundColor).toBe('#DFD8DD'); // washPlum
    expect(cell.backgroundColor).not.toBe('#7C5A7F'); // primaryLight
    expect(cell.borderWidth).toBe(1.5);
    expect(cell.borderStyle).toBe('solid');
    expect(cell.borderColor).toBe('#5B3E5D'); // primary
    expect(cell.height).toBe(16);
  });

  it('confirmed/completed are a solid primary capsule, full height, no translucency', () => {
    for (const status of ['confirmed', 'completed'] as const) {
      const cell = cellAt9(makeShift({ status }));
      expect(cell.backgroundColor).toBe('#5B3E5D'); // primary
      expect(cell.borderWidth).toBe(0);
      expect(cell.opacity).toBeUndefined();
      expect(cell.height).toBe(16);
    }
  });

  it('REGRESSION: pending/draft are a hollow 1.5px dashed warningStrong capsule, not plum@45%', () => {
    for (const status of ['pending', 'draft'] as const) {
      const cell = cellAt9(makeShift({ status }));
      expect(cell.backgroundColor).toBe('transparent');
      expect(cell.borderWidth).toBe(1.5);
      expect(cell.borderStyle).toBe('dashed');
      expect(cell.borderColor).toBe('#9C6E2E'); // warningStrong
      expect(cell.opacity).toBeUndefined();
      expect(cell.height).toBe(16);
    }
  });

  it('an empty cell is a 2px border rule, shorter than any occupied cell', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[makeShift({ status: 'confirmed' })]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
      />
    );

    // Hour 9 is occupied (the fixture shift); hour 10 on the same day is not.
    const occupied = StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.style
    );
    const empty = StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-10`).props.style
    );
    expect(empty.height).toBe(2);
    expect(empty.backgroundColor).toBe('#E5DDE2'); // border
    expect(empty.borderWidth).toBe(0);
    expect(occupied.height).toBeGreaterThan(empty.height as number);
  });
});

describe('WeekRibbonView densestShift precedence', () => {
  it('REGRESSION: cancelled-then-confirmed twins at the same starts_at paint as confirmed', () => {
    // The existing suite only ever passes one shift per day, which is why
    // it never caught this: shiftRepository order is starts_at only, so the
    // cancelled twin can sit first and densestShift's occupying[0] fallback
    // paints the cell cancelled.
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[
          makeShift({ id: 'shift-cancelled', status: 'cancelled' }),
          makeShift({ id: 'shift-confirmed', status: 'confirmed' }),
        ]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
      />
    );

    expect(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.accessibilityLabel
    ).toBe('confirmed');
  });

  it('cancelled-only cell colour is not the empty-cell colour', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[makeShift({ status: 'cancelled' })]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
      />
    );

    const cancelled = StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.style
    );
    const empty = StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-10`).props.style
    );
    expect(cancelled.backgroundColor).not.toBe(empty.backgroundColor);
  });
});

describe('WeekRibbonView uncovered cells', () => {
  it('paints an uncovered window cell and the uncovered legend item', () => {
    const { getByTestId, getByText } = render(
      <WeekRibbonView
        shifts={[]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
        uncoveredByDay={{ '2026-08-03': [makeUncoveredWindow()] }}
      />
    );

    expect(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.accessibilityLabel
    ).toBe('uncovered');
    expect(getByText('cover.rowPill')).toBeTruthy();
  });

  it('REGRESSION: uncovered is a solid full-height warningStrong capsule, not an outline', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
        uncoveredByDay={{ '2026-08-03': [makeUncoveredWindow()] }}
      />
    );

    const cell = StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.style
    );
    // warningStrong, not warning: #C08A3E is only 2.7:1 on the ground.
    expect(cell.backgroundColor).toBe('#9C6E2E');
    expect(cell.borderWidth).toBe(0);
    // Full height — the most important cell on the grid must not read as "less".
    expect(cell.height).toBe(16);
  });

  it('uncovered wins over a shift in the same cell', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[makeShift({ status: 'confirmed' })]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
        uncoveredByDay={{ '2026-08-03': [makeUncoveredWindow()] }}
      />
    );

    expect(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.accessibilityLabel
    ).toBe('uncovered');
  });

  it('omits uncovered cells and the uncovered legend item when uncoveredByDay is omitted', () => {
    const { getByTestId, queryByText, queryByLabelText } = render(
      <WeekRibbonView
        shifts={[makeShift({ status: 'confirmed' })]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
      />
    );

    expect(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.accessibilityLabel
    ).toBe('confirmed');
    expect(queryByLabelText('uncovered')).toBeNull();
    expect(queryByText('cover.rowPill')).toBeNull();
  });
});

describe('WeekRibbonView awaiting windows', () => {
  it('paints an awaiting window as pending, not uncovered', () => {
    // A pending weekly pattern materialises no shifts, so the window is all
    // there is — it must read as "asked, waiting", never as the amber gap.
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[]}
        displayTimeZone="UTC"
        weekDates={WEEK_DATES}
        householdTimeZone="UTC"
        uncoveredByDay={{}}
        awaitingByDay={{ '2026-08-03': [makeUncoveredWindow()] }}
      />
    );

    const cell = getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`);
    expect(cell.props.accessibilityLabel).toBe('pending');
    const style = StyleSheet.flatten(cell.props.style);
    // Same hollow dashed amber as a pending shift.
    expect(style.backgroundColor).toBe('transparent');
    expect(style.borderStyle).toBe('dashed');
    expect(style.borderColor).toBe('#9C6E2E'); // warningStrong
  });

  it('an uncovered window still wins over an awaiting one in the same cell', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[]}
        displayTimeZone="UTC"
        weekDates={WEEK_DATES}
        householdTimeZone="UTC"
        uncoveredByDay={{ '2026-08-03': [makeUncoveredWindow()] }}
        awaitingByDay={{ '2026-08-03': [makeUncoveredWindow()] }}
      />
    );

    expect(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.accessibilityLabel
    ).toBe('uncovered');
  });
});
