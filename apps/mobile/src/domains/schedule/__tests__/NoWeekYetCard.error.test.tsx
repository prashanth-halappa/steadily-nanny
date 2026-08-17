/**
 * @module domains/schedule/__tests__/NoWeekYetCard.error
 *
 * False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): the card's own
 * header comment already says it must never render on a failed read — "the
 * card claims nothing is scheduled, and saying that off a 404 or a dropped
 * connection is a lie" — but the guard only ever checked `isLoading`, never
 * `isError`. A settled-with-error query has `isLoading: false`, so a failed
 * patterns or members read fell straight through and rendered anyway.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_ID = '22222222-2222-4222-8222-222222222222';

let NoWeekYetCard: typeof import('../components/NoWeekYetCard').NoWeekYetCard;
let store: typeof import('@/src/store/todayCardDismissalStore').useTodayCardDismissalStore;
let patternsIsError = false;
let membersIsError = false;

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock() }),
    router: { push: mock() },
    Link: ({ children }: { children: unknown }) => children,
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ role: 'nanny', isPastMember: false }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      householdId: HOUSEHOLD_ID,
      household: {
        id: HOUSEHOLD_ID,
        name: 'the Ahmeds',
        state: 'live',
        timezone: 'UTC',
        week_starts_on: 1,
      },
      households: [],
      isLoading: false,
    }),
  }));
  mock.module('@/src/domains/today/hooks/useTermsGate', () => ({
    useTermsGate: () => ({ status: 'open', familyName: 'the Ahmeds' }),
  }));
  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: () => ({
      data: patternsIsError ? undefined : [],
      isLoading: false,
      isSuccess: !patternsIsError,
      isError: patternsIsError,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: membersIsError
        ? undefined
        : [
            {
              user_id: NANNY_ID,
              role: 'nanny',
              status: 'active',
              joined_at: '2020-01-01T00:00:00.000Z',
            },
          ],
      isLoading: false,
      isSuccess: !membersIsError,
      isError: membersIsError,
    }),
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: () => ({ data: [], isLoading: false, isSuccess: true }),
    isShiftsRouteUnavailable: () => false,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (sel: (s: unknown) => unknown) =>
      sel({ session: { user: { id: NANNY_ID } }, user: { id: NANNY_ID } }),
  }));

  NoWeekYetCard = (await import('../components/NoWeekYetCard')).NoWeekYetCard;
  store = (await import('@/src/store/todayCardDismissalStore'))
    .useTodayCardDismissalStore;
});

beforeEach(() => {
  store.getState().reset();
  patternsIsError = false;
  membersIsError = false;
});

describe('NoWeekYetCard — a failed patterns or members read never claims "no week yet"', () => {
  it('renders nothing when the patterns read failed', () => {
    patternsIsError = true;
    const { queryByTestId } = render(<NoWeekYetCard />);
    expect(queryByTestId('today-no-week-yet-card')).toBeNull();
  });

  it('renders nothing when the members read failed', () => {
    membersIsError = true;
    const { queryByTestId } = render(<NoWeekYetCard />);
    expect(queryByTestId('today-no-week-yet-card')).toBeNull();
  });

  it('renders normally once both reads succeed', () => {
    const { getByTestId } = render(<NoWeekYetCard />);
    expect(getByTestId('today-no-week-yet-card')).toBeTruthy();
  });
});
