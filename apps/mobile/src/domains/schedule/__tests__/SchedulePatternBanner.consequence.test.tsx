/**
 * @module domains/schedule/__tests__/SchedulePatternBanner.consequence
 *
 * The banner-vs-summary decision, pinned.
 *
 * A parent with no usual week set saw BOTH "you haven't set the weekly hours"
 * AND a warning-toned pill reading "Who's covering N windows this week?".
 * They are two different facts — a cause and this week's consequence — and the
 * no-pattern state is exactly the one with the most gaps to report, so
 * suppressing the count was the wrong remedy. But rendered as a separate pill
 * it wore the same skin as this screen's NON-interactive status labels, so the
 * parent read one alarm printed twice.
 *
 * Resolution: fold the consequence into the cause. One card, both facts, one
 * action. The settled (accepted) arm has no card, so it must NOT swallow the
 * node — its caller renders it standalone instead.
 *
 * Mocking setup copied from the sibling `SchedulePatternBanner.closedHousehold`.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CURRENT_USER_ID = '33333333-3333-4333-8333-333333333333';

let SchedulePatternBanner: typeof import('../components/SchedulePatternBanner').SchedulePatternBanner;

beforeAll(async () => {
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ role: 'parent' as const }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        {
          user_id: CARER_USER_ID,
          role: 'nanny',
          display_name_override: 'Priya',
          profile_name: null,
        },
      ],
    }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ user: { id: CURRENT_USER_ID } }),
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock() }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
  }));

  const mod = await import('../components/SchedulePatternBanner');
  SchedulePatternBanner = mod.SchedulePatternBanner;
});

function makePattern(overrides: Partial<SchedulePattern>): SchedulePattern {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_USER_ID,
    status: 'pending',
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    dtstart: '2026-08-05',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: null,
    decline_message: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as SchedulePattern;
}

const consequence = <Text testID="cover-count">4 windows unbooked</Text>;

describe('SchedulePatternBanner consequence slot', () => {
  it('folds the uncovered count INTO the attention card, above its action', () => {
    const { getByTestId } = render(
      <SchedulePatternBanner
        pattern={null}
        householdId={HOUSEHOLD_ID}
        consequence={consequence}
      />
    );

    // The card, the cause, the consequence and ONE action, all present.
    expect(getByTestId('schedule-pattern-banner')).toBeTruthy();
    expect(getByTestId('schedule-pattern-banner-status')).toBeTruthy();
    expect(getByTestId('cover-count')).toBeTruthy();
    expect(getByTestId('schedule-pattern-banner-action')).toBeTruthy();
  });

  it('still folds it when a usual week is merely pending, not absent', () => {
    const { getByTestId } = render(
      <SchedulePatternBanner
        pattern={makePattern({ status: 'pending', sent_at: null })}
        householdId={HOUSEHOLD_ID}
        consequence={consequence}
      />
    );
    expect(getByTestId('cover-count')).toBeTruthy();
  });

  it('renders nothing extra when there is no uncovered count to fold', () => {
    const { queryByTestId } = render(
      <SchedulePatternBanner pattern={null} householdId={HOUSEHOLD_ID} />
    );
    expect(queryByTestId('cover-count')).toBeNull();
    expect(queryByTestId('schedule-pattern-banner-status')).toBeTruthy();
  });

  it('does NOT swallow it in the settled arm, which has no card to fold into', () => {
    const { queryByTestId } = render(
      <SchedulePatternBanner
        pattern={makePattern({ status: 'accepted' })}
        householdId={HOUSEHOLD_ID}
        consequence={consequence}
      />
    );
    // The caller renders it standalone in this state; swallowing it here would
    // lose the count entirely on a household whose week IS set.
    expect(queryByTestId('cover-count')).toBeNull();
  });
});
