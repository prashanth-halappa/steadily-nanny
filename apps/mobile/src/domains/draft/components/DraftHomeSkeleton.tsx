/**
 * @module domains/draft/components/DraftHomeSkeleton
 *
 * §12's loading row. A skeleton must match the RUNG it becomes
 * (`daylight-v2.md` §6.9): the L1 stand-in is a tall TINTED block, the two L3
 * stand-ins are white cards, and the L4 stand-ins are bare rows. A white card
 * standing in for a tinted attention card makes the loaded state visibly
 * jump, which is the one thing a skeleton exists to prevent.
 *
 * The hero band is NOT here — it needs no network and renders immediately
 * above this.
 */
import { View } from 'react-native';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import { useElevation } from '~/lib/design-tokens/elevation';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

export function DraftHomeSkeleton() {
  const elevation = useElevation();
  const colors = useThemeColors();

  return (
    <View testID="draft-skeleton" className="gap-3" accessibilityRole="none">
      <View
        testID="draft-skeleton-l1"
        className="gap-3 rounded-card p-5.5"
        // Tinted, like the attention card it becomes. Inline style, not a
        // className: `surfaceAttention` is a theme token, not a Tailwind hue.
        style={[
          elevation.cardProminent,
          { backgroundColor: colors.surfaceAttention },
        ]}
      >
        <SkeletonShimmer width={28} height={28} borderRadius={8} />
        <SkeletonShimmer width="70%" height={20} />
        <SkeletonShimmer width="100%" height={14} />
        <SkeletonShimmer width="100%" height={56} borderRadius={12} />
      </View>

      {[0, 1].map(index => (
        <View
          key={index}
          testID="draft-skeleton-l3"
          className="gap-3 rounded-card bg-card p-5.5"
          style={elevation.card}
        >
          <SkeletonShimmer width="50%" height={18} />
          <SkeletonShimmer width="100%" height={14} />
          <SkeletonShimmer width="80%" height={14} />
        </View>
      ))}

      {[0, 1].map(index => (
        <View
          key={index}
          testID="draft-skeleton-l4"
          className="gap-2 rounded-row bg-card px-4 py-3"
          style={elevation.row}
        >
          <SkeletonShimmer width="45%" height={16} />
          <SkeletonShimmer width="65%" height={12} />
        </View>
      ))}
    </View>
  );
}
