/**
 * @module PersonAvatar
 *
 * A circular initial badge for a person (parent, nanny, helper). Derives its
 * initial from `name` and must never crash on an empty or whitespace-only
 * name — it falls back to a neutral glyph instead.
 */

import { cva } from 'class-variance-authority';
import { View } from 'react-native';
import { remapChildSwatch } from '@/lib/design-tokens/palette';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

const FALLBACK_INITIAL = '?';

/** First letter of the trimmed name, uppercased. Never throws. */
function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0
    ? trimmed.charAt(0).toUpperCase()
    : FALLBACK_INITIAL;
}

const personAvatarVariants = cva('items-center justify-center rounded-full', {
  variants: {
    size: {
      sm: 'h-8 w-8',
      md: 'h-touch w-touch',
      lg: 'h-16 w-16',
    },
  },
  defaultVariants: { size: 'md' },
});

const personAvatarTextVariants = cva('font-semibold text-foreground', {
  variants: {
    size: {
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-lg',
    },
  },
  defaultVariants: { size: 'md' },
});

interface PersonAvatarProps {
  name: string;
  /** Caller-provided per-person colour (e.g. a household member's chosen
   * swatch). Dynamic, data-driven — applied as an inline style, never a
   * literal Tailwind class. Falls back to a semantic `bg-muted` when absent. */
  colour?: string;
  size?: 'sm' | 'md' | 'lg';
  testID?: string;
}

export function PersonAvatar({
  name,
  colour,
  size = 'md',
  testID,
}: PersonAvatarProps) {
  const initial = getInitial(name);
  const resolvedColour = colour ? remapChildSwatch(colour) : undefined;

  return (
    <View
      testID={testID}
      className={cn(
        personAvatarVariants({ size }),
        !resolvedColour && 'bg-muted'
      )}
      style={resolvedColour ? { backgroundColor: resolvedColour } : undefined}
      accessibilityRole="image"
      accessibilityLabel={name.trim().length > 0 ? name : 'Unnamed'}
    >
      <Text className={cn(personAvatarTextVariants({ size }))}>{initial}</Text>
    </View>
  );
}

export type { PersonAvatarProps };
