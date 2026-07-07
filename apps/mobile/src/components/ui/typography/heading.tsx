/**
 * Heading Typography Components
 *
 * H1, H2, H3, H4 heading components for page structure.
 */

import * as Slot from '@rn-primitives/slot';
import { Text as RNText } from 'react-native';
import { typography } from '@/lib/design-tokens/typography';
import { cn } from '@/lib/utils';
import type { TypographyProps } from './types';

export function H1({
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
          fontSize: typography.h1.size,
          lineHeight: typography.h1.lineHeight,
          fontFamily: typography.h1.fontFamily,
          letterSpacing: typography.h1.letterSpacing,
        },
        style,
      ]}
      className={cn(
        'web:scroll-m-20 text-foreground lg:text-5xl web:select-text',
        className
      )}
      {...props}
    />
  );
}

export function H2({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      role="heading"
      aria-level="2"
      style={[
        {
          fontSize: typography.h2.size,
          lineHeight: typography.h2.lineHeight,
          fontFamily: typography.h2.fontFamily,
          letterSpacing: typography.h2.letterSpacing,
        },
        style,
      ]}
      className={cn(
        'web:scroll-m-20 border-b border-border pb-2 text-foreground first:mt-0 web:select-text',
        className
      )}
      {...props}
    />
  );
}

export function H3({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      role="heading"
      aria-level="3"
      style={[
        {
          fontSize: typography.h3.size,
          lineHeight: typography.h3.lineHeight,
          fontFamily: typography.h3.fontFamily,
          letterSpacing: typography.h3.letterSpacing,
        },
        style,
      ]}
      className={cn(
        'web:scroll-m-20 text-foreground web:select-text',
        className
      )}
      {...props}
    />
  );
}

export function H4({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      role="heading"
      aria-level="4"
      style={[
        {
          fontSize: typography.h4.size,
          lineHeight: typography.h4.lineHeight,
          fontFamily: typography.h4.fontFamily,
          letterSpacing: typography.h4.letterSpacing,
        },
        style,
      ]}
      className={cn(
        'web:scroll-m-20 text-foreground web:select-text',
        className
      )}
      {...props}
    />
  );
}
