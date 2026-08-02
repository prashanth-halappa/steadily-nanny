/**
 * @module domains/setup/components/RoleOptionCard
 *
 * A single selectable "I'm a parent" / "I'm a nanny" card for the role-fork
 * screen. Plain `AnimatedPressable` + `className` (no Reanimated Animated.View
 * here, so the GOLDEN-FIXES #2 className restriction doesn't apply).
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
        'rounded-2xl border-2 p-4',
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
