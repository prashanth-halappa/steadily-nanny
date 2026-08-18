/**
 * @module domains/today/__tests__/ThisWeekCard.test
 *
 * #9's merge: three routine cards (`NannyWeekLine`, `AddMissedHoursCard`,
 * `ThisWeeksShiftsCard`) became one labelled block in the feed. It is a
 * COMPOSITION, not a rewrite — the three keep their own files, their own
 * tests and their own behaviour; this card only decides which of them a given
 * viewer sees, and gives them a heading that routes somewhere.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SETUP_ROLES } from '@/src/domains/setup/types';

const HOUSEHOLD_ID = 'household-week-1';

function marker(name: string) {
  const React = require('react');
  return () => React.createElement('View', { testID: name });
}

let ThisWeekCard: typeof import('../components/ThisWeekCard').ThisWeekCard;
let mockPush: ReturnType<typeof mock>;
let mockArrangement: ReturnType<typeof mock>;
let lastMissedHoursProps: Record<string, unknown> | null = null;

beforeAll(async () => {
  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
  }));
  mock.module('@/src/domains/today/components/NannyWeekLine', () => ({
    NannyWeekLine: marker('nanny-week-line-stub'),
  }));
  mock.module('@/src/domains/today/components/AddMissedHoursCard', () => {
    const React = require('react');
    return {
      AddMissedHoursCard: (props: Record<string, unknown>) => {
        lastMissedHoursProps = props;
        return React.createElement('View', {
          testID: 'add-missed-hours-stub',
        });
      },
    };
  });
  mockArrangement = mock(() => ({ data: null }));
  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: mockArrangement,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: 'carer-week-1' } } }),
  }));
  mock.module('@/src/domains/schedule', () => ({
    // Both no-schedule cards render null on an ordinary day; stubbed so this
    // suite's subject is the only thing under test.
    WeeklyHoursNotSetCard: () => null,
    NoWeekYetCard: () => null,
    ThisWeeksShiftsCard: marker('this-weeks-shifts-stub'),
  }));

  const mod = await import('../components/ThisWeekCard');
  ThisWeekCard = mod.ThisWeekCard;
});

function renderCard(role: 'nanny' | 'parent', isPastMember = false) {
  return render(
    <ThisWeekCard
      householdId={HOUSEHOLD_ID}
      timeZone="UTC"
      weekStartsOn={1}
      role={role === 'nanny' ? SETUP_ROLES.NANNY : SETUP_ROLES.PARENT}
      isPastMember={isPastMember}
    />
  );
}

describe('ThisWeekCard', () => {
  it('gathers the nanny-only week cards for an active nanny', () => {
    const { getByTestId } = renderCard('nanny');

    expect(getByTestId('today-this-week-card')).toBeTruthy();
    expect(getByTestId('nanny-week-line-stub')).toBeTruthy();
    expect(getByTestId('add-missed-hours-stub')).toBeTruthy();
    expect(getByTestId('this-weeks-shifts-stub')).toBeTruthy();
  });

  it('shows a parent only the shifts half — the other two are her pay, not his', () => {
    const { queryByTestId, getByTestId } = renderCard('parent');

    expect(getByTestId('this-weeks-shifts-stub')).toBeTruthy();
    expect(queryByTestId('nanny-week-line-stub')).toBeNull();
    expect(queryByTestId('add-missed-hours-stub')).toBeNull();
  });

  // Every write on a household she was removed from 403s server-side.
  it('drops the nanny-only cards for a past member', () => {
    const { queryByTestId, getByTestId } = renderCard('nanny', true);

    expect(getByTestId('this-weeks-shifts-stub')).toBeTruthy();
    expect(queryByTestId('nanny-week-line-stub')).toBeNull();
    expect(queryByTestId('add-missed-hours-stub')).toBeNull();
  });

  it('routes the eyebrow to Hours for a nanny and Schedule for a parent', () => {
    const nanny = renderCard('nanny');
    fireEvent.press(
      nanny.getByTestId('today-this-week-eyebrow-label-header-press')
    );
    expect(mockPush).toHaveBeenLastCalledWith('/(private)/(tabs)/hours');

    const parent = renderCard('parent');
    fireEvent.press(
      parent.getByTestId('today-this-week-eyebrow-label-header-press')
    );
    expect(mockPush).toHaveBeenLastCalledWith('/(private)/(tabs)/schedule');
  });

  it('localizes the eyebrow through the today namespace', () => {
    const { getByTestId } = renderCard('parent');
    expect(
      within(getByTestId('today-this-week-eyebrow-label')).getByText(
        'thisWeek.title'
      )
    ).toBeTruthy();
  });
});

/**
 * A1's worst case, handled without an escape hatch. She worked nine hours
 * before terms existed; the blocked card warned her and named the route. This
 * is that route arriving, once, in the days right after acceptance — and then
 * quietly going back to being the ordinary recovery affordance.
 */
describe('ThisWeekCard — the post-acceptance headline', () => {
  function arrangementAgedDays(days: number) {
    mockArrangement.mockImplementation(() => ({
      data: {
        id: 'arr-1',
        created_at: new Date(
          Date.now() - days * 24 * 60 * 60 * 1000
        ).toISOString(),
      },
    }));
  }

  it('asks for the headline in the first week of a brand-new arrangement', () => {
    arrangementAgedDays(2);

    renderCard('nanny');

    expect(lastMissedHoursProps?.firstRunHeadline).toBe(true);
  });

  it('stops asking once the arrangement is a week old', () => {
    arrangementAgedDays(8);

    renderCard('nanny');

    expect(lastMissedHoursProps?.firstRunHeadline).toBe(false);
  });

  it('does not ask when there is no arrangement at all — she is still blocked', () => {
    mockArrangement.mockImplementation(() => ({ data: null }));

    renderCard('nanny');

    expect(lastMissedHoursProps?.firstRunHeadline).toBe(false);
  });
});
