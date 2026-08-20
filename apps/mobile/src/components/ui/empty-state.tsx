/**
 * EmptyState Component
 * Display when there's no data to show.
 */

import type { LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { Image, type ImageSourcePropType, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { easingSignature } from '@/lib/animations/easing';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';
import { spacing } from '~/lib/design-tokens/spacing';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

interface EmptyStateProps {
  icon?: LucideIcon;
  image?: ImageSourcePropType;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
  className?: string;
  variant?: 'default' | 'inline' | 'compact';
}

const ILLUSTRATION_GROUND_SCALE = 1.6;

const VARIANT_STYLES = {
  default: {
    container: 'flex-1 items-center justify-center px-6 py-12',
    iconWrapper:
      'h-24 w-24 items-center justify-center rounded-cell bg-chip-plum mb-4',
    iconSize: 40,
    imageSize: 200,
    titleClassName: 'text-center mb-2',
    descriptionClassName: 'text-center text-muted-foreground mb-6 max-w-sm',
  },
  inline: {
    container: 'items-center justify-center px-4 py-8',
    iconWrapper:
      'h-16 w-16 items-center justify-center rounded-cell bg-chip-plum mb-3',
    iconSize: 28,
    imageSize: 160,
    titleClassName: 'text-center mb-1',
    descriptionClassName: 'text-center text-muted-foreground mb-4',
  },
} as const;

function EmptyStateIllustration({
  image,
  imageSize,
  groundColor,
}: {
  image: ImageSourcePropType;
  imageSize: number;
  groundColor: string;
}) {
  const groundSize = imageSize * ILLUSTRATION_GROUND_SCALE;

  // The wrapper is sized to the GROUND, not the image. The ground is 1.6x the
  // image and absolutely positioned, and RN does not clip by default — sizing
  // this box to `imageSize` made it overflow 0.3x in every direction and paint
  // over whatever sat above it (on the Schedule tab, the Agenda/Week/Rhythm
  // switcher). Don't "fix" that with overflow-hidden: it crops the circle into
  // a rounded square. A view that reports its true footprint just lays out.
  return (
    <View
      style={{
        width: groundSize,
        height: groundSize,
        marginBottom: 16,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          width: groundSize,
          height: groundSize,
          borderRadius: groundSize / 2,
          backgroundColor: groundColor,
        }}
      />
      <Image
        source={image}
        style={{
          width: imageSize,
          height: imageSize,
          // 6px has no Daylight token — nearest is rounded-sm (8px).
          borderRadius: spacing.radiusSm,
        }}
        resizeMode="contain"
        accessibilityElementsHidden
      />
    </View>
  );
}

function useEmptyStateAnimation() {
  const reducedMotion = useReducedMotion();
  const translateY = useSharedValue(30);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!reducedMotion) {
      setTimeout(() => {
        translateY.value = withTiming(0, {
          duration: easingSignature.gentleRise.duration,
          easing: easingSignature.gentleRise.easing,
        });
        opacity.value = withTiming(1, {
          duration: easingSignature.gentleRise.duration,
          easing: easingSignature.gentleRise.easing,
        });
      }, 100);
    } else {
      translateY.value = 0;
      opacity.value = 1;
    }
  }, [opacity, reducedMotion, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return animatedStyle;
}

export function EmptyState({
  icon: IconComponent,
  image,
  title,
  description,
  action,
  actionLabel,
  className,
  variant = 'default',
}: EmptyStateProps) {
  const colors = useThemeColors();
  const animatedStyle = useEmptyStateAnimation();
  const isInline = variant === 'inline';
  const styles = VARIANT_STYLES[isInline ? 'inline' : 'default'];
  const resolvedActionLabel = actionLabel || 'Get started';

  return (
    // `flex: 1` belongs here, not on the child: the default variant's container
    // is flex-1, and a flex-1 child of a content-sized parent collapses to
    // nothing — the 240px illustration then paints half its height above the
    // box. Inline stays content-sized (it lives in ScrollViews and list empty
    // slots). Inline style, never a className — GOLDEN-FIXES #2.
    <Animated.View style={[isInline ? null : { flex: 1 }, animatedStyle]}>
      <View
        className={cn(styles.container, className)}
        accessibilityRole="text"
        accessibilityLabel={`${title}. ${description}`}
      >
        {image ? (
          <EmptyStateIllustration
            image={image}
            imageSize={styles.imageSize}
            groundColor={colors.chip.plum}
          />
        ) : IconComponent ? (
          <View className={styles.iconWrapper}>
            <Icon
              icon={IconComponent}
              size={styles.iconSize}
              className="text-muted-foreground"
            />
          </View>
        ) : null}

        <H3 className={styles.titleClassName}>{title}</H3>
        <Body className={styles.descriptionClassName}>{description}</Body>

        {action &&
          (isInline ? (
            <Button
              size="sm"
              variant="outline"
              onPress={action}
              accessibilityLabel={actionLabel}
            >
              <Text className="font-medium">{actionLabel}</Text>
            </Button>
          ) : (
            <Button
              onPress={action}
              accessibilityLabel={resolvedActionLabel}
              accessibilityRole="button"
            >
              <Text className="text-primary-foreground font-medium">
                {resolvedActionLabel}
              </Text>
            </Button>
          ))}
      </View>
    </Animated.View>
  );
}

export function EmptyStateInline(props: Omit<EmptyStateProps, 'variant'>) {
  return <EmptyState {...props} variant="inline" />;
}

export function EmptyStateCompact({
  icon: IconComponent,
  message,
  className,
}: {
  icon: LucideIcon;
  message: string;
  className?: string;
}) {
  return (
    <View
      className={cn(
        'flex-row items-center justify-center gap-2 p-4',
        className
      )}
      accessibilityRole="text"
      accessibilityLabel={message}
    >
      <Icon icon={IconComponent} size={20} className="text-muted-foreground" />
      <Text className="text-base text-muted-foreground">{message}</Text>
    </View>
  );
}
