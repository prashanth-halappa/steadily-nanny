/**
 * @module PersonAvatar
 *
 * A circular initial badge for a person (parent, nanny, helper). Derives its
 * initial from `name` and must never crash on an empty or whitespace-only
 * name — it falls back to a neutral glyph instead.
 */

import { cva } from 'class-variance-authority';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { palette, remapChildSwatch } from '@/lib/design-tokens/palette';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

const FALLBACK_INITIAL = '?';

/** Closed 3-hue set — same tokens `useThemeColors().category` projects. */
const NAME_ACCENTS = [
  palette.light.categoryAccent1.hex,
  palette.light.categoryAccent2.hex,
  palette.light.categoryAccent3.hex,
] as const;

/** First letter of the trimmed name, uppercased. Never throws. */
function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0
    ? trimmed.charAt(0).toUpperCase()
    : FALLBACK_INITIAL;
}

/** Deterministic category accent for a person name. Closed 3-hue palette. */
export function colourForName(name: string): string {
  const trimmed = name.trim();
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  return NAME_ACCENTS[hash % NAME_ACCENTS.length] ?? NAME_ACCENTS[0];
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
   * literal Tailwind class. When omitted, a non-empty name hashes onto a
   * category accent; unnamed avatars stay on semantic `bg-muted`. */
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
  const { t } = useTranslation('common');
  const initial = getInitial(name);
  const trimmed = name.trim();
  const resolvedColour = colour
    ? remapChildSwatch(colour)
    : trimmed.length > 0
      ? colourForName(name)
      : undefined;

  return (
    <View
      testID={testID}
      className={cn(
        personAvatarVariants({ size }),
        !resolvedColour && 'bg-muted'
      )}
      style={resolvedColour ? { backgroundColor: resolvedColour } : undefined}
      accessibilityRole="image"
      accessibilityLabel={name.trim().length > 0 ? name : t('a11y.unnamed')}
    >
      <Text className={cn(personAvatarTextVariants({ size }))}>{initial}</Text>
    </View>
  );
}

export type { PersonAvatarProps };
