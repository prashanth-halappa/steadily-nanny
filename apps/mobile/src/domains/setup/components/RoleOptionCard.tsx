/**
 * @module domains/setup/components/RoleOptionCard
 *
 * A single selectable "I'm a parent" / "I'm a nanny" card for the role-fork
 * screen. Uses `AnimatedPressable` (Reanimated `createAnimatedComponent(Pressable)`).
 * GOLDEN-FIXES #2 forbids NativeWind `className` on Reanimated `Animated.View`
 * specifically — Pressable-based animated wrappers are the established exception
 * (same pattern as `button.tsx` and Settings rows).
 */
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';

interface RoleOptionCardProps {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

export function RoleOptionCard({
  title,
  description,
  selected,
  onPress,
  testID,
}: RoleOptionCardProps) {
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      scaleIntensity="subtle"
      onPress={onPress}
      className={cn(
        'rounded-card border-2 p-4',
        selected ? 'border-primary bg-primary/5' : 'border-border bg-card'
      )}
    >
      <View className="gap-1">
        <Text
          className={cn(
            'font-semibold text-lg',
            selected ? 'text-primary' : 'text-foreground'
          )}
        >
          {title}
        </Text>
        <Body className="text-muted-foreground">{description}</Body>
      </View>
    </AnimatedPressable>
  );
}

export type { RoleOptionCardProps };
