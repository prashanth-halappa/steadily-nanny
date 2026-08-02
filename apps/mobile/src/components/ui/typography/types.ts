/**
 * Typography Types
 *
 * Shared types for all typography components.
 */

import type * as React from 'react';
import type { Text as RNText } from 'react-native';

export type TypographyProps = React.ComponentProps<typeof RNText> & {
  ref?: React.RefObject<RNText>;
  asChild?: boolean;
  /** Align digits in columns (RN fontVariant — not expressible as NativeWind). */
  tabular?: boolean;
};
