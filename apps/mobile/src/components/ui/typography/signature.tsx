/**
 * Signature Typography Components
 *
 * Expressive typography for distinctive moments and emotional connection.
 */

import * as Slot from '@rn-primitives/slot';
import { Text as RNText } from 'react-native';
import { typography } from '@/lib/design-tokens/typography';
import { cn } from '@/lib/utils';
import type { TypographyProps } from './types';

export function SignatureHeroLight({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      style={[
        {
          fontSize: typography.signature.heroLight.size,
          lineHeight: typography.signature.heroLight.lineHeight,
          fontFamily: typography.signature.heroLight.fontFamily,
          letterSpacing: typography.signature.heroLight.letterSpacing,
        },
        style,
      ]}
      className={cn('text-foreground web:select-text', className)}
      {...props}
    />
  );
}

export function SignatureHeroBold({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      style={[
        {
          fontSize: typography.signature.heroBold.size,
          lineHeight: typography.signature.heroBold.lineHeight,
          fontFamily: typography.signature.heroBold.fontFamily,
          letterSpacing: typography.signature.heroBold.letterSpacing,
        },
        style,
      ]}
      className={cn('text-foreground web:select-text', className)}
      {...props}
    />
  );
}

export function SignatureMilestoneHeading({
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
          fontSize: typography.signature.milestoneHeading.size,
          lineHeight: typography.signature.milestoneHeading.lineHeight,
          fontFamily: typography.signature.milestoneHeading.fontFamily,
          letterSpacing: typography.signature.milestoneHeading.letterSpacing,
        },
        style,
      ]}
      className={cn('text-foreground web:select-text', className)}
      {...props}
    />
  );
}

export function SignatureContemplative({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      style={[
        {
          fontSize: typography.signature.contemplative.size,
          lineHeight: typography.signature.contemplative.lineHeight,
          fontFamily: typography.signature.contemplative.fontFamily,
          letterSpacing: typography.signature.contemplative.letterSpacing,
        },
        style,
      ]}
      className={cn('text-foreground web:select-text', className)}
      {...props}
    />
  );
}
