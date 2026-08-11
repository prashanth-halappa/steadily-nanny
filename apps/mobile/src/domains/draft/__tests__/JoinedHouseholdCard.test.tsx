/**
 * @module domains/draft/__tests__/JoinedHouseholdCard
 *
 * §8.1. She just joined a household and she must be told what she joined —
 * the parent's dialog names everything and hers named nothing, which is the
 * wrong asymmetry.
 *
 * The D-21 line is the point of the card. Walking into an existing placement
 * with an incumbent nanny, the first question is "can she see what I'm paid".
 * D-21 makes the answer no, and this sentence is the only place the app ever
 * says so. It is a fact, not a reassurance.
 */
import { describe, expect, it, mock } from 'bun:test';
import { renderWithProviders } from '@/src/test-utils';
import { JoinedHouseholdCard } from '../components/JoinedHouseholdCard';

const composition = {
  children: [
    { name: 'Ayla', age: 5 },
    { name: 'Sam', age: 2 },
  ],
  parentCount: 2,
  otherCarerCount: 1,
};

describe('JoinedHouseholdCard', () => {
  it('names what she joined', () => {
    const { getByTestId } = renderWithProviders(
      <JoinedHouseholdCard
        familyName="Ahmeds"
        composition={composition}
        onSeeTerms={mock()}
      />
    );

    expect(getByTestId('draft-joined-title')).toBeTruthy();
  });

  it('states D-21 to the person it protects', () => {
    const { getByTestId } = renderWithProviders(
      <JoinedHouseholdCard
        familyName="Ahmeds"
        composition={composition}
        onSeeTerms={mock()}
      />
    );

    expect(getByTestId('draft-joined-privacy').props.children).toBe(
      'joined.privacy'
    );
  });

  it('says the privacy line even while she is still a candidate', () => {
    const { getByTestId } = renderWithProviders(
      <JoinedHouseholdCard
        familyName="Ahmeds"
        composition={null}
        onSeeTerms={mock()}
      />
    );

    // The moment she is wondering is the moment she redeemed, not the moment
    // they accepted.
    expect(getByTestId('draft-joined-privacy')).toBeTruthy();
  });

  it('withholds the composition until they accept', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <JoinedHouseholdCard
        familyName="Ahmeds"
        composition={null}
        onSeeTerms={mock()}
      />
    );

    // A `candidate` reads nothing of the household by design (§8.2.1); the
    // children's names are not hers yet.
    expect(queryByTestId('draft-joined-composition')).toBeNull();
    expect(getByTestId('draft-joined-waiting')).toBeTruthy();
  });

  it('renders the composition once they have accepted', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <JoinedHouseholdCard
        familyName="Ahmeds"
        composition={composition}
        onSeeTerms={mock()}
      />
    );

    expect(getByTestId('draft-joined-composition')).toBeTruthy();
    expect(queryByTestId('draft-joined-waiting')).toBeNull();
  });

  it('leaves out the other-carer clause when there is no other carer', () => {
    const { getByTestId } = renderWithProviders(
      <JoinedHouseholdCard
        familyName="Ahmeds"
        composition={{ ...composition, otherCarerCount: 0 }}
        onSeeTerms={mock()}
      />
    );

    const line = String(getByTestId('draft-joined-composition').props.children);
    expect(line).not.toContain('otherCarers');
  });
});
