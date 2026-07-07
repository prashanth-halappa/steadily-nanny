/**
 * Display Typography Components
 *
 * Large, impactful typography for hero sections and major headings.
 */

import * as Slot from '@rn-primitives/slot';
import { Text as RNText } from 'react-native';
import { typography } from '@/lib/design-tokens/typography';
import { cn } from '@/lib/utils';
import type { TypographyProps } from './types';

export function DisplayLarge({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      role="heading"
      aria-level="1"
      style={[
        {
          fontSize: typography.displayLarge.size,
          lineHeight: typography.displayLarge.lineHeight,
          fontFamily: typography.displayLarge.fontFamily,
          letterSpacing: typography.displayLarge.letterSpacing,
        },
        style,
      ]}
      className={cn('text-foreground web:select-text', className)}
      {...props}
    />
  );
}

export function Display({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      role="heading"
      aria-level="1"
      style={[
        {
          fontSize: typography.display.size,
          lineHeight: typography.display.lineHeight,
          fontFamily: typography.display.fontFamily,
          letterSpacing: typography.display.letterSpacing,
        },
        style,
      ]}
      className={cn('text-foreground web:select-text', className)}
      {...props}
    />
  );
}
