/**
 * MomentCard — L1 delight surface. Art, title, body, optional CTA, and
 * the confetti overlay owned by useMilestone('moment').
 *
 * @module components/ui/__tests__/moment-card.test
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { MomentCard } from '@/src/components/ui/moment-card';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

const useMilestone = mock(() => ({
  easing: null,
  showConfetti: true,
}));

mock.module('@/lib/animations/useMilestone', () => ({
  useMilestone,
}));

describe('MomentCard', () => {
  beforeEach(() => {
    useMilestone.mockClear();
    useMilestone.mockReturnValue({ easing: null, showConfetti: true });
  });

  it('renders the art, title, body and cta', () => {
    const { getByTestId } = render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-1"
        action={{ label: 'See hours', onPress: () => {} }}
      />
    );

    expect(getByTestId('x-art')).toBeTruthy();
    expect(getByTestId('x-title')).toBeTruthy();
    expect(getByTestId('x-body')).toBeTruthy();
    expect(getByTestId('x-cta')).toBeTruthy();
  });

  it('calls useMilestone with the moment tier and the given key', () => {
    render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-key"
      />
    );

    expect(useMilestone).toHaveBeenCalledWith('moment', 'moment-key');
  });

  it('renders the confetti overlay when showConfetti is true', () => {
    const { getByTestId } = render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-confetti"
      />
    );

    expect(getByTestId('confetti-overlay')).toBeTruthy();
  });

  // 1.4: the joined card needs a route to the thing it says is missing
  // ("Set the pay terms") WITHOUT displacing "See her profile". One action
  // could only ever carry one of the two.
  it('renders a secondary action below the primary one', () => {
    const { getByTestId } = render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-secondary"
        action={{ label: 'See her profile', onPress: () => {} }}
        secondaryAction={{ label: 'Set the pay terms', onPress: () => {} }}
      />
    );

    expect(getByTestId('x-cta')).toBeTruthy();
    expect(getByTestId('x-secondary-cta')).toBeTruthy();
  });

  it('calls the secondary action, not the primary one', () => {
    const primary = mock();
    const secondary = mock();
    const { getByTestId } = render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-secondary-press"
        action={{ label: 'See her profile', onPress: primary }}
        secondaryAction={{ label: 'Set the pay terms', onPress: secondary }}
      />
    );

    fireEvent.press(getByTestId('x-secondary-cta'));

    expect(secondary).toHaveBeenCalledTimes(1);
    expect(primary).not.toHaveBeenCalled();
  });

  // Ghost, so the primary keeps its weight — two filled buttons on a
  // celebration card read as a fork in the road, not a follow-up.
  it('paints the secondary action ghost, never the primary fill', () => {
    const { getByTestId } = render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-secondary-ghost"
        action={{ label: 'See her profile', onPress: () => {} }}
        secondaryAction={{ label: 'Set the pay terms', onPress: () => {} }}
      />
    );

    expect(getByTestId('x-secondary-cta').props.variant).toBe('ghost');
    expect(getByTestId('x-cta').props.variant).toBeUndefined();
  });

  it('omits the secondary action when none is given', () => {
    const { queryByTestId } = render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-no-secondary"
        action={{ label: 'See her profile', onPress: () => {} }}
      />
    );

    expect(queryByTestId('x-secondary-cta')).toBeNull();
  });

  it('omits the cta when no action is given', () => {
    const { queryByTestId } = render(
      <MomentCard
        testID="x"
        illustration="welcomeHero"
        title="You did it"
        body="The week is in."
        momentKey="moment-no-cta"
      />
    );

    expect(queryByTestId('x-cta')).toBeNull();
  });
});
