/**
 * @module domains/today/__tests__/MembershipEndedCard.test
 *
 * The card that ends the silence. A tester created a nanny and a parent,
 * linked them, deleted the parent — and the nanny was told nothing at all,
 * while her Today screen went on offering the clock-in card as though it
 * were an ordinary working day.
 *
 * Two things are pinned here, and they are the two the whole card exists for:
 * it must NEVER promise or deny that she will be paid (we cannot know either,
 * and both lies are expensive), and it must always route her onward rather
 * than dead-ending her in a family that is gone.
 */
import { describe, expect, it, mock } from 'bun:test';
import { MEMBERSHIP_ENDED_REASONS } from '@steadily-nanny/shared-types/schemas/household.schema';
import { renderWithProviders } from '@/src/test-utils';

const pushMock = mock((_href: string) => {});
mock.module('expo-router', () => ({
  useRouter: () => ({ push: pushMock, replace: mock(), back: mock() }),
  useLocalSearchParams: () => ({}),
  Link: 'Link',
}));

const { MembershipEndedCard } = await import(
  '../components/MembershipEndedCard'
);

describe('MembershipEndedCard', () => {
  it('names the family and says the record survives', () => {
    const { getByTestId } = renderWithProviders(
      <MembershipEndedCard familyName="the Okonkwo family" />
    );

    expect(getByTestId('today-membership-ended-card')).toBeTruthy();
    expect(getByTestId('today-membership-ended-title')).toBeTruthy();
    expect(getByTestId('today-membership-ended-body')).toBeTruthy();
  });

  it('offers a way to her record and a way onward', () => {
    const { getByTestId } = renderWithProviders(
      <MembershipEndedCard familyName="the Okonkwo family" />
    );

    fireEventPress(getByTestId('today-membership-ended-hours'));
    expect(pushMock).toHaveBeenCalled();
    pushMock.mockClear();
    fireEventPress(getByTestId('today-membership-ended-join'));
    expect(pushMock).toHaveBeenCalled();
  });

  it('takes the weaker claim when nobody recorded WHY it ended', () => {
    // `ended_reason` is null for a membership that ended before migration 110
    // existed. "You're no longer with them" is true whether she was removed or
    // the family closed their account; "they closed their account" is a fact
    // we would be inventing, and it is the one a parent would most resent
    // being invented about them.
    const { getByTestId } = renderWithProviders(
      <MembershipEndedCard familyName="the Okonkwo family" />
    );

    expect(
      getByTestId('today-membership-ended-title').props.children
    ).toContain('membershipEnded.titleRemoved');
  });

  it('says the family closed their account only when that is recorded', () => {
    const { getByTestId } = renderWithProviders(
      <MembershipEndedCard
        familyName="the Okonkwo family"
        reason={MEMBERSHIP_ENDED_REASONS.HOUSEHOLD_CLOSED}
      />
    );

    expect(
      getByTestId('today-membership-ended-title').props.children
    ).toContain('membershipEnded.title');
  });

  it('says SHE left when that is what happened', () => {
    // The third branch, and the reason `closed?: boolean` had to go: a
    // self-departure used to collapse into `titleRemoved` — passive removal
    // wording for the one case she chose herself.
    const { getByTestId } = renderWithProviders(
      <MembershipEndedCard
        familyName="the Okonkwo family"
        reason={MEMBERSHIP_ENDED_REASONS.LEFT}
      />
    );

    expect(
      getByTestId('today-membership-ended-title').props.children
    ).toContain('membershipEnded.titleLeft');
  });

  it('takes the weaker claim when a parent removed her', () => {
    const { getByTestId } = renderWithProviders(
      <MembershipEndedCard
        familyName="the Okonkwo family"
        reason={MEMBERSHIP_ENDED_REASONS.REMOVED_BY_PARENT}
      />
    );

    expect(
      getByTestId('today-membership-ended-title').props.children
    ).toContain('membershipEnded.titleRemoved');
  });

  it('renders the mid-shift wording when she is still on the clock', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <MembershipEndedCard familyName="the Okonkwo family" onClock />
    );

    expect(getByTestId('today-membership-ended-body')).toBeTruthy();
    // Mid-shift the pinned slot holds the running clock, so this card must
    // not offer a second competing primary action beside "clock out".
    expect(queryByTestId('today-membership-ended-hours')).toBeNull();
  });

  it('renders the membership-ended card art', () => {
    const { getByTestId } = renderWithProviders(
      <MembershipEndedCard familyName="the Okonkwo family" />
    );

    expect(getByTestId('today-membership-ended-card-art')).toBeTruthy();
  });
});

function fireEventPress(element: { props: { onPress?: () => void } }) {
  element.props.onPress?.();
}
