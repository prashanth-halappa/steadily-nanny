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
import { render } from '@testing-library/react-native';

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
