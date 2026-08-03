/**
 * SkeletonCard - Skeleton loading placeholder for activity cards
 *
 * Displays a warm shimmer skeleton placeholder matching the ConcernActivityCard dimensions.
 * Uses SkeletonShimmer for branded warm loading effect.
 */

import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useElevation } from '~/lib/design-tokens/elevation';
import { SkeletonShimmer } from './skeleton-shimmer';

interface SkeletonCardProps {
  /** Index for staggered animation delay (kept for API compat, unused) */
  index?: number;
}

export function SkeletonCard(_props?: SkeletonCardProps) {
  const { t } = useTranslation('common');
  const elevation = useElevation();

  return (
    <View
      testID="skeleton-card"
      // Must match <Card>'s geometry exactly — radius, padding and elevation.
      // A skeleton that separates differently from the card it stands in for
      // makes the loaded state visibly jump.
      style={[{ width: 200 }, elevation.card]}
      className="bg-card rounded-card p-5.5"
      accessibilityRole="none"
      accessibilityLabel={t('a11y.loadingActivityCard')}
    >
      {/* Concern tag skeleton */}
      <SkeletonShimmer
        testID="skeleton-concern-tag"
        width={80}
        height={22}
        borderRadius={4}
      />

      <View style={{ height: 8 }} />

      {/* Activity name skeleton */}
      <SkeletonShimmer
        testID="skeleton-activity-name"
        width="90%"
        height={20}
      />

      <View style={{ height: 4 }} />

      {/* Description skeleton - two lines */}
      <View style={{ gap: 4, marginBottom: 12 }}>
        <SkeletonShimmer
          testID="skeleton-description"
          width="100%"
          height={14}
        />
        <SkeletonShimmer width="70%" height={14} />
      </View>

      {/* Button skeleton */}
      <SkeletonShimmer
        testID="skeleton-button"
        width={80}
        height={28}
        borderRadius={4}
      />
    </View>
  );
}
