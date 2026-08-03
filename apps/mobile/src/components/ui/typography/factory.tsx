/**
 * Typography component factory for generating standard typography components.
 *
 * Eliminates boilerplate by creating components from token style objects.
 * Emits fontWeight (load-bearing on the platform face). Omits fontFamily so
 * RN uses the system face. Optional tabular numerals via fontVariant.
 */

import * as Slot from '@rn-primitives/slot';
import * as React from 'react';
import type { Role, TextStyle } from 'react-native';
import { Text as RNText } from 'react-native';
import { cn } from '@/lib/utils';
import { TextClassContext } from '@/src/components/ui/text';
import type { TypographyProps } from './types';

export interface TypographyToken {
  size: number;
  lineHeight: number;
  weight: TextStyle['fontWeight'];
  letterSpacing: number;
  fontStyle?: TextStyle['fontStyle'];
}

interface FactoryOptions {
  defaultClassName?: string;
  role?: Role;
  ariaLevel?: number | string;
  /** Align digits for tables / duration totals (RN-only; not a NativeWind class). */
  tabular?: boolean;
}

const DEFAULT_CLASS = 'text-foreground web:select-text';

/** Shared style for digit columns — prefer the `tabular` prop on typography components. */
export const tabularStyle: TextStyle = { fontVariant: ['tabular-nums'] };

export function tokenToStyle(
  token: TypographyToken,
  options?: Pick<FactoryOptions, 'tabular'>
): TextStyle {
  const style: TextStyle = {
    fontSize: token.size,
    lineHeight: token.lineHeight,
    fontWeight: token.weight,
    letterSpacing: token.letterSpacing,
  };
  if (token.fontStyle) {
    style.fontStyle = token.fontStyle;
  }
  if (options?.tabular) {
    Object.assign(style, tabularStyle);
  }
  return style;
}

export function createTypographyComponent(
  token: TypographyToken,
  displayName: string,
  options?: FactoryOptions
) {
  const baseStyle = tokenToStyle(token);
  const alwaysTabular = options?.tabular === true;
  const baseClassName = options?.defaultClassName ?? DEFAULT_CLASS;

  function TypographyComponent({
    className,
    asChild = false,
    style,
    tabular,
    ...props
  }: TypographyProps) {
    // Publish channel a container (e.g. Button) uses to override text color —
    // must lose to an explicit `className` but win over the hardcoded default.
    // Mirrors text.tsx's resolution order exactly.
    const textClass = React.useContext(TextClassContext);
    const Component = asChild ? Slot.Text : RNText;
    const useTabular = alwaysTabular || tabular === true;
    return (
      <Component
        role={options?.role}
        aria-level={options?.ariaLevel}
        style={[baseStyle, useTabular ? tabularStyle : null, style]}
        className={cn(baseClassName, textClass, className)}
        {...props}
      />
    );
  }

  TypographyComponent.displayName = displayName;
  return TypographyComponent;
}

/**
 * Body-sized digits for columns (hours, durations, week-ribbon dates).
 * For other scales use `<Body tabular>`, `<H2 tabular>`, `<Small tabular>`, etc.
 */
export const Figure = createTypographyComponent(
  {
    size: 16,
    lineHeight: 24,
    weight: '400',
    letterSpacing: 0,
  },
  'Figure',
  { tabular: true }
);
