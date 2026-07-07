/**
 * Typography component factory for generating standard typography components.
 *
 * Eliminates boilerplate by creating components from token style objects.
 */

import * as Slot from '@rn-primitives/slot';
import type { TextStyle } from 'react-native';
import { Text as RNText } from 'react-native';
import { cn } from '@/lib/utils';
import type { TypographyProps } from './types';

interface TypographyToken {
  size: number;
  lineHeight: number;
  weight: TextStyle['fontWeight'];
  fontFamily: string;
  letterSpacing: number;
  fontStyle?: TextStyle['fontStyle'];
}

interface FactoryOptions {
  defaultClassName?: string;
}

const DEFAULT_CLASS = 'text-foreground web:select-text';

function tokenToStyle(token: TypographyToken): TextStyle {
  const style: TextStyle = {
    fontSize: token.size,
    lineHeight: token.lineHeight,
    fontFamily: token.fontFamily,
    letterSpacing: token.letterSpacing,
  };
  if (token.fontStyle) {
    style.fontStyle = token.fontStyle;
  }
  return style;
}

export function createTypographyComponent(
  token: TypographyToken,
  displayName: string,
  options?: FactoryOptions
) {
  const baseStyle = tokenToStyle(token);
  const baseClassName = options?.defaultClassName ?? DEFAULT_CLASS;

  function TypographyComponent({
    className,
    asChild = false,
    style,
    ...props
  }: TypographyProps) {
    const Component = asChild ? Slot.Text : RNText;
    return (
      <Component
        style={[baseStyle, style]}
        className={cn(baseClassName, className)}
        {...props}
      />
    );
  }

  TypographyComponent.displayName = displayName;
  return TypographyComponent;
}
