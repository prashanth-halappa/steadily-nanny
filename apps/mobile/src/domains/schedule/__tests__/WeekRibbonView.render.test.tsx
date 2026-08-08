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

describe('WeekRibbonView cell tiers (P1)', () => {
  it('REGRESSION: cancelled cell paints gray200 #E5DDE2, not the heavier mutedForeground', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[makeShift({ status: 'cancelled' })]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
      />
    );

    const cell = StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.style
    );
    expect(cell.backgroundColor).toBe('#E5DDE2');
  });

  it('declined cell gets the same gray200 treatment as cancelled', () => {
    const { getByTestId } = render(
      <WeekRibbonView
        shifts={[makeShift({ status: 'declined' })]}
        weekDates={WEEK_DATES}
        householdTimeZone="Europe/London"
      />
    );

    const cell = StyleSheet.flatten(
      getByTestId(`week-ribbon-cell-${MONDAY_DOW}-9`).props.style
    );
    expect(cell.backgroundColor).toBe('#E5DDE2');
  });

  it('an empty cell renders a thin (~2px) rule instead of a full-height capsule', () => {
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
    expect(empty.height).toBeLessThanOrEqual(2);
    expect(occupied.height).toBeGreaterThan(empty.height as number);
  });
});
