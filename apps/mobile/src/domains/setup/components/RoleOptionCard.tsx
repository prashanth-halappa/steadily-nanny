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
import { Body, H4 } from '@/src/components/ui/typography';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

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
  const colors = useThemeColors();

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      scaleIntensity="subtle"
      onPress={onPress}
      style={{
        borderRadius: 20,
        borderWidth: 2,
        padding: 16,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.secondary : colors.card,
      }}
    >
      <View className="gap-1">
        <H4 className={selected ? 'text-primary' : undefined}>{title}</H4>
        <Body
          testID={testID ? `${testID}-description` : undefined}
          className="text-muted-foreground"
        >
          {description}
        </Body>
      </View>
    </AnimatedPressable>
  );
}

export type { RoleOptionCardProps };
