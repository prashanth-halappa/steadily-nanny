/**
 * CardArt — a grounded illustration for ordinary cards.
 *
 * The quiet counterpart to MomentCard. MomentCard hardcodes
 * `useMilestone('moment')`, so it fires a celebration haptic and a confetti
 * burst on render — right for "your first week, approved", wrong for "set
 * your weekly hours". CardArt is the same plum-grounded art with none of
 * that: no milestone tier, no haptic, no confetti, no entrance animation.
 *
 * ponytail: the ground math (1.6x, absolute circle) is duplicated from
 * `moment-card` and `empty-state`. Extract a shared primitive if a fourth
 * caller appears — not before; both of those ship today and refactoring them
 * buys regression risk on milestone screens for no visible change.
 *
 * @module components/ui/card-art
 */

import { Image, View } from 'react-native';
import { type IllustrationKey, illustrations } from '@/assets/illustrations';
import { spacing } from '~/lib/design-tokens/spacing';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

const ILLUSTRATION_GROUND_SCALE = 1.6;

/**
 * `sm` replaces an IconChip in a card's header row; `md` is a centred hero
 * inside the card body. Both sit on the 8pt grid at art AND ground size,
 * and both are deliberately quieter than MomentCard's 160/256.
 */
const SIZE_CONFIG = {
  sm: 40,
  md: 80,
} as const;

export type CardArtSize = keyof typeof SIZE_CONFIG;

export interface CardArtProps {
  illustration: IllustrationKey;
  size?: CardArtSize;
  testID?: string;
}

export function CardArt({ illustration, size = 'md', testID }: CardArtProps) {
  const colors = useThemeColors();
  const artSize = SIZE_CONFIG[size];
  const groundSize = artSize * ILLUSTRATION_GROUND_SCALE;

  return (
    // Sized to the GROUND, not the image — the ground is 1.6x and absolutely
    // positioned, and RN does not clip by default, so a box sized to the art
    // overflows and paints over the card's padding and rounded corners. Don't
    // "fix" that with overflow-hidden: it crops the circle into a rounded
    // square. Same trap documented in `empty-state` and `moment-card`.
    <View
      testID={testID}
      style={{
        width: groundSize,
        height: groundSize,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        testID={testID ? `${testID}-ground` : undefined}
        style={{
          position: 'absolute',
          width: groundSize,
          height: groundSize,
          borderRadius: groundSize / 2,
          backgroundColor: colors.chip.plum,
        }}
      />
      <Image
        testID={testID ? `${testID}-image` : undefined}
        source={illustrations[illustration]}
        style={{
          width: artSize,
          height: artSize,
          borderRadius: spacing.radiusSm,
        }}
        resizeMode="contain"
        accessibilityElementsHidden
      />
    </View>
  );
}
