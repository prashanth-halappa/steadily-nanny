/**
 * @module domains/today/__tests__/InviteWaitingCard.test
 *
 * "Hide this" did nothing until the app was relaunched. The write reached
 * MMKV, but `useTodayCardDismissalStore(s => s.isDismissed)` subscribes to a
 * STABLE FUNCTION REFERENCE — only `dismissedKeys` changes on `set()`, so
 * zustand never re-rendered the subscriber and the card sat there looking
 * broken. Pinned here so it cannot come back.
 *
 * This suite deliberately does NOT mock `todayCardDismissalStore`: the real
 * store over the in-memory MMKV shim is the only thing that can catch that
 * bug. A mocked function-ref factory passes either way.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2024-05-01T12:00:00.000Z');

let InviteWaitingCard: typeof import('../components/InviteWaitingCard').InviteWaitingCard;
let store: typeof import('@/src/store/todayCardDismissalStore').useTodayCardDismissalStore;

beforeAll(async () => {
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mock() }),
  }));
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) =>
        vars && Object.keys(vars).length > 0
          ? `${key}(${Object.values(vars).join(',')})`
          : key,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdInvites', () => ({
    useHouseholdInvites: () => ({
      data: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          household_id: HOUSEHOLD_ID,
          code: 'R4K-92T',
          email: null,
          role: 'nanny',
          status: 'pending',
          invited_by: '11111111-1111-4111-8111-111111111111',
          expires_at: '2030-01-01T00:00:00.000Z',
          accepted_by: null,
          accepted_at: null,
          link_expires_at: null,
          opened_at: null,
          label: null,
          pay_offer: null,
          created_at: new Date(
            NOW.getTime() - 1000 * 60 * 60 * 24
          ).toISOString(), // 1 day ago
          updated_at: new Date(
            NOW.getTime() - 1000 * 60 * 60 * 24
          ).toISOString(),
        },
      ],
      isLoading: false,
      isSuccess: true,
    }),
  }));

  InviteWaitingCard = (await import('../components/InviteWaitingCard'))
    .InviteWaitingCard;
  store = (await import('@/src/store/todayCardDismissalStore'))
    .useTodayCardDismissalStore;
});

beforeEach(() => {
  store.getState().reset();
});

describe('InviteWaitingCard', () => {
  it('renders the card variant for a recent pending nanny invite', () => {
    const { getByTestId } = render(
      <InviteWaitingCard
        householdId={HOUSEHOLD_ID}
        hasActiveNanny={false}
        now={NOW}
      />
    );
    expect(getByTestId('today-invite-waiting')).toBeTruthy();
    expect(getByTestId('today-invite-waiting-art')).toBeTruthy();
    expect(getByTestId('today-invite-waiting-code')).toBeTruthy();
  });

  it('disappears the moment she hides it, not on the next launch', () => {
    const { getByTestId, queryByTestId } = render(
      <InviteWaitingCard
        householdId={HOUSEHOLD_ID}
        hasActiveNanny={false}
        now={NOW}
      />
    );
    fireEvent.press(getByTestId('today-invite-waiting-dismiss'));
    expect(queryByTestId('today-invite-waiting')).toBeNull();
  });

  // WP-K: this card's whole subject is "waiting on the nanny to act" —
  // dashed border, no shadow, plus a line promising she'll be told.
  it('is provisional (dashed border) and promises a heads-up the moment someone joins', () => {
    const { getByTestId, getByText } = render(
      <InviteWaitingCard
        householdId={HOUSEHOLD_ID}
        hasActiveNanny={false}
        now={NOW}
      />
    );
    const className = getByTestId('today-invite-waiting').props
      .className as string;
    expect(className).toContain('border-dashed');
    expect(getByText('waitingOnNanny.promise')).toBeTruthy();
  });
});
