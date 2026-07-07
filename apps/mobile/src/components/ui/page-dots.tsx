/**
 * Page Dots Component
 *
 * Simple pagination indicator with active/inactive dot states.
 * Used for horizontal carousels and swipeable content.
 */

import { View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';
import { colors } from '~/lib/design-tokens/colors';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

interface PageDotsProps extends ViewProps {
  /** Total number of pages */
  count: number;
  /** Currently active page index (0-based) */
  activeIndex: number;
  /** Active dot color (default: primary) */
  activeColor?: string;
  /** Inactive dot color (default: border) */
  inactiveColor?: string;
}

function PageDots({
  count,
  activeIndex,
  activeColor = colors.primary.DEFAULT,
  inactiveColor,
  className,
  ...props
}: PageDotsProps) {
  const themeColors = useThemeColors();
  const resolvedInactiveColor = inactiveColor ?? themeColors.border;
  if (count <= 1) return null;

  return (
    <View
      className={cn('flex-row items-center justify-center gap-1.5', className)}
      accessibilityRole="tablist"
      accessibilityLabel={`Page ${activeIndex + 1} of ${count}`}
      {...props}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: Static array for dots
          key={i}
          className={cn(
            'rounded-full',
            i === activeIndex ? 'w-2 h-2' : 'w-1.5 h-1.5'
          )}
          style={{
            backgroundColor:
              i === activeIndex ? activeColor : resolvedInactiveColor,
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: i === activeIndex }}
        />
      ))}
    </View>
  );
}

export type { PageDotsProps };
export { PageDots };
