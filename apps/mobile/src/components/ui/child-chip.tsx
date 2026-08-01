/**
 * @module ChildChip
 *
 * A child's name plus a colour dot. When `onPress` is absent it MUST render
 * as non-interactive — a plain View, no press affordance, no haptic — never
 * an AnimatedPressable. Only wire it up as pressable when the caller
 * actually needs a tap handler (e.g. a child-picker), so read-only contexts
 * (a shift's assigned-children list) don't imply a fake affordance.
 */

import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

interface ChildChipProps {
  name: string;
  /** Caller-provided colour dot (e.g. `children.colour`). Dynamic,
   * data-driven — applied as an inline style, never a literal class. */
  colour?: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function ChildChip({
  name,
  colour,
  selected = false,
  onPress,
  testID,
}: ChildChipProps) {
  const containerClassName = cn(
    'flex-row items-center gap-1.5 self-start rounded-full px-3 py-1.5',
    selected ? 'bg-primary' : 'bg-muted'
  );

  const content = (
    <>
      <View
        testID={testID ? `${testID}-dot` : undefined}
        className={cn(
          'h-2.5 w-2.5 rounded-full',
          !colour && 'bg-muted-foreground'
        )}
        style={colour ? { backgroundColor: colour } : undefined}
      />
      <Text
        className={cn(
          'font-sora-medium text-sm',
          selected ? 'text-primary-foreground' : 'text-foreground'
        )}
      >
        {name}
      </Text>
    </>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        className={containerClassName}
        accessibilityRole="text"
      >
        {content}
      </View>
    );
  }

  return (
    <AnimatedPressable
      testID={testID}
      className={containerClassName}
      onPress={onPress}
      haptic="light"
      scaleIntensity="subtle"
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {content}
    </AnimatedPressable>
  );
}

export type { ChildChipProps };
