/**
 * @module domains/today/__tests__/MemberLeftCard.test
 *
 * The parent-side half of a departure. The nanny gets `MembershipEndedCard`
 * on her own Today screen; before this, the family she left got nothing at
 * all — the roster simply had one fewer row the next time anyone opened it.
 *
 * Two things are pinned. The title must not call a resignation a removal
 * (the whole reason `ended_reason` exists), and "Got it" must HIDE — the
 * dismissal is written to the real MMKV-backed store, so a card dismissed
 * here is still gone after a remount. This suite deliberately does NOT mock
 * `todayCardDismissalStore`: a mocked function-ref factory passes whether or
 * not the component subscribes reactively, which is exactly the bug
 * `useCardDismissal` exists to prevent (see `InviteWaitingCard.test.tsx`).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { MEMBERSHIP_ENDED_REASONS } from '@steadily-nanny/shared-types/schemas/household.schema';
import { fireEvent, render } from '@testing-library/react-native';

const DISMISS_KEY = 'memberLeft:household-1:member-1';

let MemberLeftCard: typeof import('../components/MemberLeftCard').MemberLeftCard;
let store: typeof import('@/src/store/todayCardDismissalStore').useTodayCardDismissalStore;

beforeAll(async () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) =>
        vars && Object.keys(vars).length > 0
          ? `${key}(${Object.values(vars).join(',')})`
          : key,
    }),
  }));

  MemberLeftCard = (await import('../components/MemberLeftCard'))
    .MemberLeftCard;
  store = (await import('@/src/store/todayCardDismissalStore'))
    .useTodayCardDismissalStore;
});

beforeEach(() => {
  store.getState().reset();
});

describe('MemberLeftCard', () => {
  it('says she LEFT when that is what the membership recorded', () => {
    const { getByTestId } = render(
      <MemberLeftCard
        name="Amara"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
        memberRole="nanny"
        dismissKey={DISMISS_KEY}
      />
    );

    expect(getByTestId('today-member-left-title').props.children).toContain(
      'memberLeft.titleLeft'
    );
  });

  it('takes the neutral wording for a removal, and for an unrecorded reason', () => {
    const removed = render(
      <MemberLeftCard
        name="Amara"
        reason={MEMBERSHIP_ENDED_REASONS.REMOVED_BY_PARENT}
        memberRole="nanny"
        dismissKey={DISMISS_KEY}
      />
    );
    expect(
      removed.getByTestId('today-member-left-title').props.children
    ).toContain('memberLeft.titleRemoved');

    const unknown = render(
      <MemberLeftCard
        name="Amara"
        reason={null}
        memberRole="nanny"
        dismissKey="memberLeft:household-1:member-2"
      />
    );
    expect(
      unknown.getByTestId('today-member-left-title').props.children
    ).toContain('memberLeft.titleRemoved');
  });

  it('says what a departing CARER leaves behind, not what a co-parent does', () => {
    const carer = render(
      <MemberLeftCard
        name="Amara"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
        memberRole="nanny"
        dismissKey={DISMISS_KEY}
      />
    );
    expect(
      carer.getByTestId('today-member-left-body').props.children
    ).toContain('memberLeft.bodyCarer');

    const parent = render(
      <MemberLeftCard
        name="Sam"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
        memberRole="parent"
        dismissKey="memberLeft:household-1:member-3"
      />
    );
    expect(
      parent.getByTestId('today-member-left-body').props.children
    ).toContain('memberLeft.bodyMember');
  });

  it('names the person in the dismiss label — two departure cards can stack', () => {
    const { getByTestId } = render(
      <MemberLeftCard
        name="Amara"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
        memberRole="nanny"
        dismissKey={DISMISS_KEY}
      />
    );

    expect(
      getByTestId('today-member-left-dismiss').props.accessibilityLabel
    ).toBe('memberLeft.dismissLabel(Amara)');
  });

  it('disappears the moment it is dismissed, and stays gone across a remount', () => {
    const first = render(
      <MemberLeftCard
        name="Amara"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
        memberRole="nanny"
        dismissKey={DISMISS_KEY}
      />
    );
    fireEvent.press(first.getByTestId('today-member-left-dismiss'));
    expect(first.queryByTestId('today-member-left-card')).toBeNull();

    const second = render(
      <MemberLeftCard
        name="Amara"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
        memberRole="nanny"
        dismissKey={DISMISS_KEY}
      />
    );
    expect(second.queryByTestId('today-member-left-card')).toBeNull();
  });

  it('is a plain card — leaving is not a moment, so there is no celebration', () => {
    const { queryByTestId } = render(
      <MemberLeftCard
        name="Amara"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
        memberRole="nanny"
        dismissKey={DISMISS_KEY}
      />
    );

    expect(queryByTestId('moment-card-confetti')).toBeNull();
  });
});
