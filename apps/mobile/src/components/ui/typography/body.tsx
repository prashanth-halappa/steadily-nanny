/**
 * Body Typography Components
 *
 * Body text components for paragraphs and content.
 */

import * as Slot from '@rn-primitives/slot';
import { Platform, Text as RNText } from 'react-native';
import { typography } from '@/lib/design-tokens/typography';
import { cn } from '@/lib/utils';
import { createTypographyComponent, tokenToStyle } from './factory';
import type { TypographyProps } from './types';

export const P = createTypographyComponent(typography.bodyLarge, 'P');
export const Body = createTypographyComponent(typography.body, 'Body');
export const BodyLight = createTypographyComponent(
  typography.bodyLight,
  'BodyLight'
);

export const Lead = createTypographyComponent(
  {
    size: typography.h3.size,
    lineHeight: typography.h3.lineHeight,
    weight: typography.bodyLarge.weight,
    letterSpacing: typography.bodyLarge.letterSpacing,
  },
  'Lead',
  { defaultClassName: 'text-muted-foreground web:select-text' }
);

export const Large = createTypographyComponent(typography.h3, 'Large');

export const Small = createTypographyComponent(
  {
    size: typography.bodySmall.size,
    lineHeight: typography.bodySmall.lineHeight,
    weight: typography.label.weight,
    letterSpacing: typography.bodySmall.letterSpacing,
  },
  'Small',
  { defaultClassName: 'text-foreground leading-none web:select-text' }
);

export const Muted = createTypographyComponent(typography.bodySmall, 'Muted', {
  defaultClassName: 'text-muted-foreground web:select-text',
});

export function BlockQuote({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      // @ts-expect-error - role of blockquote renders blockquote element on the web
      role={Platform.OS === 'web' ? 'blockquote' : undefined}
      style={[tokenToStyle(typography.body), style]}
      className={cn(
        'mt-6 native:mt-4 border-l-2 border-border pl-6 native:pl-3 text-foreground italic web:select-text',
        className
      )}
      {...props}
    />
  );
}

export function Code({
  className,
  asChild = false,
  style,
  ...props
}: TypographyProps) {
  const Component = asChild ? Slot.Text : RNText;
  return (
    <Component
      // @ts-expect-error - role of code renders code element on the web
      role={Platform.OS === 'web' ? 'code' : undefined}
      style={[tokenToStyle(typography.bodySmall), style]}
      className={cn(
        'relative rounded-md bg-muted px-[0.3rem] py-[0.2rem] text-foreground web:select-text',
        className
      )}
      {...props}
    />
  );
}
