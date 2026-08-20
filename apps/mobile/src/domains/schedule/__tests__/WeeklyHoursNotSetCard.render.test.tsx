/**
 * WeeklyHoursNotSetCard — render coverage for the group card.
 *
 * The card has two distinct render branches (the combined `setup` card naming
 * every carer, and the per-carer `draft`/`declined` card) sharing ONE testID,
 * so a test that renders only one of them silently covers half the component.
 * Both are exercised here.
 *
 * @module domains/schedule/__tests__/WeeklyHoursNotSetCard.render.test
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { WeeklyHoursNotSetGroup } from '@/src/domains/schedule/components/WeeklyHoursNotSetCard.utils';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

let WeeklyHoursNotSetGroupCard: typeof import('@/src/domains/schedule/components/WeeklyHoursNotSetCard').WeeklyHoursNotSetGroupCard;

beforeAll(async () => {
  WeeklyHoursNotSetGroupCard = (
    await import('@/src/domains/schedule/components/WeeklyHoursNotSetCard')
  ).WeeklyHoursNotSetGroupCard;
});

const SETUP_GROUP: WeeklyHoursNotSetGroup = {
  kind: 'setup',
  carerUserIds: ['carer-1'],
  dismissKeys: ['dismiss-1'],
};

const DRAFT_GROUP: WeeklyHoursNotSetGroup = {
  kind: 'draft',
  carerUserId: 'carer-1',
  dismissKey: 'dismiss-1',
};

function renderCard(group: WeeklyHoursNotSetGroup) {
  return render(
    <WeeklyHoursNotSetGroupCard
      group={group}
      nameFor={() => 'Maria'}
      activePatternFor={() => null}
      uncoveredIsSetup={true}
      onDismiss={() => {}}
      onNavigate={() => {}}
    />
  );
}

describe('WeeklyHoursNotSetGroupCard', () => {
  it('renders the setup branch with its card, cta and ad-hoc door', () => {
    const { getByTestId } = renderCard(SETUP_GROUP);

    expect(getByTestId('today-weekly-hours-not-set-card')).toBeTruthy();
    expect(getByTestId('today-weekly-hours-not-set-cta')).toBeTruthy();
    // The second answer to "when does she work?" — days booked as they come.
    expect(getByTestId('today-weekly-hours-not-set-adhoc')).toBeTruthy();
  });

  it('renders the solo branch with no ad-hoc door', () => {
    const { getByTestId, queryByTestId } = renderCard(DRAFT_GROUP);

    expect(getByTestId('today-weekly-hours-not-set-card')).toBeTruthy();
    expect(getByTestId('today-weekly-hours-not-set-cta')).toBeTruthy();
    expect(queryByTestId('today-weekly-hours-not-set-adhoc')).toBeNull();
  });
});
