/**
 * CardArt — the quiet grounded illustration used inside ordinary cards.
 *
 * The whole point of this component is that it is NOT MomentCard: it carries
 * no milestone tier, so no haptic and no confetti fire when an ordinary card
 * like "set your weekly hours" renders. Those guarantees are pinned here.
 *
 * @module components/ui/__tests__/card-art.test
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { CardArt } from '@/src/components/ui/card-art';
import { palette } from '~/lib/design-tokens/palette';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

/** Read straight off the style array — the RN test double drops values when
 *  flattening, so `StyleSheet.flatten` is not safe here (see receipt-card). */
function styleOf(node: { props: { style?: unknown } }): Record<string, any> {
  const style = node.props.style;
  const layers = Array.isArray(style) ? style : [style];
  return Object.assign({}, ...layers.filter(Boolean)) as Record<string, any>;
}

/**
 * The art carries `accessibilityElementsHidden`, which takes it out of the
 * a11y tree — and RNTL's queries skip hidden elements by default, so every
 * lookup of the image has to opt back in. Keep the attribute: it is the thing
 * keeping decorative art out of a screen reader's path.
 */
const HIDDEN = { includeHiddenElements: true } as const;

describe('CardArt', () => {
  it('renders the art wrapper, ground and image', () => {
    const { getByTestId } = render(
      <CardArt illustration="welcomeHero" testID="x-art" />
    );

    expect(getByTestId('x-art')).toBeTruthy();
    expect(getByTestId('x-art-ground')).toBeTruthy();
    expect(getByTestId('x-art-image', HIDDEN)).toBeTruthy();
  });

  // The ground is 1.6x the art and absolutely positioned. The wrapper must be
  // sized to the GROUND or it overflows 0.3x in every direction and paints
  // over the card's own padding — the same trap called out in empty-state.
  it('sizes the wrapper to the ground, not the image', () => {
    const { getByTestId } = render(
      <CardArt illustration="welcomeHero" size="md" testID="x-art" />
    );

    const wrapper = styleOf(getByTestId('x-art'));
    const image = styleOf(getByTestId('x-art-image', HIDDEN));

    expect(wrapper.width).toBe(128);
    expect(wrapper.height).toBe(128);
    expect(image.width).toBe(80);
    expect(wrapper.width).toBe(image.width * 1.6);
  });

  it('sizes the small variant for a card header slot', () => {
    const { getByTestId } = render(
      <CardArt illustration="welcomeHero" size="sm" testID="x-art" />
    );

    const wrapper = styleOf(getByTestId('x-art'));
    const image = styleOf(getByTestId('x-art-image', HIDDEN));

    expect(wrapper.width).toBe(64);
    expect(image.width).toBe(40);
    expect(wrapper.width).toBe(image.width * 1.6);
  });

  it('defaults to the md size', () => {
    const { getByTestId } = render(
      <CardArt illustration="welcomeHero" testID="x-art" />
    );

    expect(styleOf(getByTestId('x-art')).width).toBe(128);
  });

  it('paints a circular chip-plum ground', () => {
    const { getByTestId } = render(
      <CardArt illustration="welcomeHero" size="md" testID="x-art" />
    );

    const ground = styleOf(getByTestId('x-art-ground'));

    expect(ground.backgroundColor).toBe(palette.light.chipPlum.hex);
    expect(ground.borderRadius).toBe(64); // groundSize / 2 — a true circle
    expect(ground.position).toBe('absolute');
  });

  it('renders the image contained and hidden from assistive tech', () => {
    const { getByTestId } = render(
      <CardArt illustration="welcomeHero" testID="x-art" />
    );

    const image = getByTestId('x-art-image', HIDDEN);

    expect(image.props.resizeMode).toBe('contain');
    expect(image.props.accessibilityElementsHidden).toBe(true);
    expect(styleOf(image).borderRadius).toBe(8); // spacing.radiusSm
  });

  // The load-bearing difference from MomentCard. If CardArt ever grows a
  // milestone tier, every ordinary card using it starts firing a celebration
  // haptic and a confetti burst on render.
  it('never fires a milestone, haptic or confetti', () => {
    const { queryByTestId } = render(
      <CardArt illustration="welcomeHero" testID="x-art" />
    );

    expect(queryByTestId('confetti-overlay')).toBeNull();
  });
});
