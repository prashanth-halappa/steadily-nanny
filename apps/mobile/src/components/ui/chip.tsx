/**
 * Chip Component
 * Display metadata tags/badges with icon support
 *
 * Features:
 * - Multiple variants (default, primary, success, etc.)
 * - Size variants (sm, default)
 * - Optional icon support
 * - Consistent styling
 *
 * Usage:
 * <Chip icon={Clock}>5 min</Chip>
 * <Chip variant="success" size="sm">New</Chip>
 */

import type { LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { easingSignature } from '@/lib/animations/easing';
import { useReducedMotion } from '@/lib/animations/useReducedMotion';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';

interface ChipProps {
  children: React.ReactNode;
  icon?: LucideIcon;
  variant?:
    | 'default'
    | 'primary'
    | 'success'
    | 'warning'
    | 'error'
    | 'secondary';
  size?: 'sm' | 'default';
  className?: string;
}

export function Chip({
  children,
  icon: IconComponent,
  variant = 'default',
  size = 'default',
  className,
}: ChipProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!reducedMotion) {
      scale.value = withTiming(1, {
        duration: easingSignature.growthBloom.duration,
        easing: easingSignature.growthBloom.easing,
      });
      opacity.value = withTiming(1, {
        duration: easingSignature.growthBloom.duration,
        easing: easingSignature.growthBloom.easing,
      });
    } else {
      scale.value = 1;
      opacity.value = 1;
    }
  }, [opacity, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  // Size classes
  const sizeClasses = {
    sm: 'px-2 py-1 gap-1',
    default: 'px-3 py-1.5 gap-1.5',
  };

  // Variant classes
  const variantClasses = {
    default: 'bg-muted',
    primary: 'bg-primary/10',
    success: 'bg-success/10',
    warning: 'bg-warning/10',
    error: 'bg-destructive/10',
    secondary: 'bg-secondary/10',
  };

  // Icon size based on chip size
  const iconSize = size === 'sm' ? 12 : 14;

  // Icon color based on variant
  const iconColorClass = {
    default: 'text-muted-foreground',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-destructive',
    secondary: 'text-secondary-foreground',
  };

  // Text classes
  const textSizeClass = size === 'sm' ? 'text-xs' : 'text-sm';
  const textColorClass = {
    default: 'text-foreground',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-destructive',
    secondary: 'text-secondary-foreground',
  };

  return (
    <Animated.View style={animatedStyle}>
      <View
        className={cn(
          'flex-row items-center rounded-full',
          sizeClasses[size],
          variantClasses[variant],
          className
        )}
        accessibilityRole="text"
      >
        {IconComponent && (
          <Icon
            icon={IconComponent}
            size={iconSize}
            className={iconColorClass[variant]}
          />
        )}
        <Text
          className={cn(
            'font-sora-medium',
            textSizeClass,
            textColorClass[variant]
          )}
        >
          {children}
        </Text>
      </View>
    </Animated.View>
  );
}
