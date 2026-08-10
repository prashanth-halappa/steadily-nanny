/**
 * @module IconChip
 *
 * Daylight v2 category icon chip — opaque tinted ground + stroked Lucide icon.
 * See docs/design/daylight-v2.md §6.1.
 */

import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';
import {
  type ThemeColors,
  useThemeColors,
} from '~/lib/design-tokens/useThemeColors';

export type IconChipTone = 'brand' | 'schedule' | 'hours' | 'people';

type IconChipSize = 'sm' | 'default';

export interface IconChipProps {
  tone: IconChipTone;
  icon: LucideIcon;
  /** Settings rows: 24×24 ground, 14px icon. Default is 28×28, 16px icon. */
  size?: IconChipSize;
  testID?: string;
}

function toneColors(
  tone: IconChipTone,
  colors: ThemeColors
): { background: string; icon: string } {
  switch (tone) {
    case 'brand':
      return { background: colors.chip.plum, icon: colors.primary };
    case 'schedule':
      return {
        background: colors.chip.cat1,
        icon: colors.category.accent1,
      };
    case 'hours':
      return {
        background: colors.chip.cat2,
        icon: colors.category.accent2,
      };
    case 'people':
      return {
        background: colors.chip.cat3,
        icon: colors.category.accent3,
      };
  }
}

const SIZE_CONFIG: Record<
  IconChipSize,
  { dimensionClass: string; iconSize: number }
> = {
  default: { dimensionClass: 'h-7 w-7', iconSize: 16 },
  sm: { dimensionClass: 'h-6 w-6', iconSize: 14 },
};

export function IconChip({
  tone,
  icon,
  size = 'default',
  testID,
}: IconChipProps) {
  const colors = useThemeColors();
  const { background, icon: iconColor } = toneColors(tone, colors);
  const { dimensionClass, iconSize } = SIZE_CONFIG[size];

  return (
    <View
      testID={testID}
      className={cn('items-center justify-center rounded-cell', dimensionClass)}
      style={{ backgroundColor: background }}
    >
      <Icon icon={icon} size={iconSize} color={iconColor} strokeWidth={2} />
    </View>
  );
}
