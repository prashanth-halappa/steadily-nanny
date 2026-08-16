/**
 * MomentCard — L1 delight surface. Art, title, body, optional CTA, and
 * the confetti overlay owned by useMilestone('moment').
 *
 * @module components/ui/__tests__/moment-card.test
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
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
