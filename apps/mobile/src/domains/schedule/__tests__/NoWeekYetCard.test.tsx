/**
 * @module domains/schedule/__tests__/NoWeekYetCard.test
 *
 * Two on-device defects found by Maestro, pinned here so they cannot return:
 *
 *  1. Tapping "Hide this" did not remove the card until the app was
 *     relaunched. The write reached MMKV, but `useTodayCardDismissalStore(s
 *     => s.isDismissed)` subscribes to a STABLE FUNCTION REFERENCE — only
 *     `dismissedKeys` changes on `set()`, so zustand never re-rendered the
 *     subscriber and the card sat there looking broken.
 *  2. The two ghost CTAs sat in a `flex-row`, and their combined intrinsic
 *     width overflowed a 402pt screen — "Hide this" rendered clipped as
 *     "Hide t…" with its right edge at x=445. Maestro's accessibility-driven
 *     tap still reached it; a finger could not.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_ID = '22222222-2222-4222-8222-222222222222';

let NoWeekYetCard: typeof import('../components/NoWeekYetCard').NoWeekYetCard;
let store: typeof import('@/src/store/todayCardDismissalStore').useTodayCardDismissalStore;

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock() }),
    router: { push: mock() },
    Link: ({ children }: { children: unknown }) => children,
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) =>
        vars && Object.keys(vars).length > 0
          ? `${key}(${Object.values(vars).join(',')})`
          : key,
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
      data: [],
      isLoading: false,
      isSuccess: true,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      // Joined long ago, so the welcome card is not competing for the frame.
      data: [
        {
          user_id: NANNY_ID,
          role: 'nanny',
          status: 'active',
          joined_at: '2020-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
      isSuccess: true,
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
});

describe('NoWeekYetCard', () => {
  it('offers her both an availability check and a way out', () => {
    const { getByTestId } = render(<NoWeekYetCard />);
    expect(getByTestId('today-no-week-yet-card')).toBeTruthy();
    expect(getByTestId('today-no-week-yet-availability')).toBeTruthy();
    expect(getByTestId('today-no-week-yet-hide')).toBeTruthy();
  });

  it('disappears the moment she hides it, not on the next launch', () => {
    const { getByTestId, queryByTestId } = render(<NoWeekYetCard />);
    fireEvent.press(getByTestId('today-no-week-yet-hide'));
    expect(queryByTestId('today-no-week-yet-card')).toBeNull();
  });

  it('stacks its two actions so neither can be clipped off a narrow screen', () => {
    const { getByTestId } = render(<NoWeekYetCard />);
    const hide = getByTestId('today-no-week-yet-hide');
    // Walk up to the container holding both CTAs.
    const row = getByTestId('today-no-week-yet-availability').parent;
    const classes = String(row?.props?.className ?? '');
    expect(classes).not.toContain('flex-row');
    expect(hide).toBeTruthy();
  });
});
