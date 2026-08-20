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
import { remapChildSwatch } from '@/lib/design-tokens/palette';
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
    'flex-row items-center gap-1.5 self-start rounded-chip px-3 py-1.5',
    selected ? 'bg-primary' : 'bg-secondary'
  );

  const resolvedColour = colour ? remapChildSwatch(colour) : undefined;

  const content = (
    <>
      <View
        testID={testID ? `${testID}-dot` : undefined}
        className={cn(
          'h-2.5 w-2.5 rounded-full',
          !resolvedColour && 'bg-muted-foreground'
        )}
        style={resolvedColour ? { backgroundColor: resolvedColour } : undefined}
      />
      <Text
        // 00-FOUNDATIONS.md §8.4 — selection is weight AND fill together, never
        // fill alone: a colour-only selection state is what 01-LAWS.md §2 bans.
        className={cn(
          'text-sm',
          selected
            ? 'font-semibold text-primary-foreground'
            : 'font-medium text-foreground'
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
