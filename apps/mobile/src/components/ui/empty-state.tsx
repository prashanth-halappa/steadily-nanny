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
import { spacing } from '~/lib/design-tokens/spacing';

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

const VARIANT_STYLES = {
  default: {
    container: 'flex-1 items-center justify-center px-6 py-12',
    iconWrapper:
      'w-24 h-24 rounded-full bg-muted items-center justify-center mb-4',
    iconSize: 40,
    title: 'text-xl font-semibold text-center mb-2 text-foreground',
    description: 'text-base text-muted-foreground text-center mb-6 max-w-sm',
  },
  inline: {
    container: 'items-center justify-center px-4 py-8',
    iconWrapper:
      'w-16 h-16 rounded-full bg-muted items-center justify-center mb-3',
    iconSize: 28,
    title: 'text-lg font-semibold text-center mb-1 text-foreground',
    description: 'text-sm text-muted-foreground text-center mb-4',
  },
} as const;

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
          <Image
            source={image}
            style={
              isInline
                ? {
                    width: 160,
                    height: 160,
                    // 6px has no Daylight token — nearest is rounded-sm (8px).
                    borderRadius: spacing.radiusSm,
                    marginBottom: 16,
                  }
                : {
                    width: 240,
                    height: 240,
                    borderRadius: spacing.radiusSm,
                    marginBottom: 16,
                  }
            }
            resizeMode="contain"
            accessibilityElementsHidden
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

        <Text className={styles.title}>{title}</Text>
        <Text className={styles.description}>{description}</Text>

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
