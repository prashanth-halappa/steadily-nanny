/**
 * @module components/ui/week-nav-header
 * Shared ‹ week-range › navigation row used by Hours (`WeekTotal`) and the
 * Schedule calendar. Keeps the two tabs from drifting into different week
 * controls (parent CX C2).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { spacing } from '@/lib/design-tokens/spacing';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Small } from '@/src/components/ui/typography';

export interface WeekNavHeaderProps {
  label: string;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  previousAccessibilityLabel: string;
  nextAccessibilityLabel: string;
  isPreviousDisabled?: boolean;
  isNextDisabled?: boolean;
  /** Defaults keep Hours testIDs stable; Schedule overrides. */
  previousTestID?: string;
  nextTestID?: string;
  labelTestID?: string;
}

export function WeekNavHeader({
  label,
  onPreviousWeek,
  onNextWeek,
  previousAccessibilityLabel,
  nextAccessibilityLabel,
  isPreviousDisabled = false,
  isNextDisabled = false,
  previousTestID = 'hours-week-prev',
  nextTestID = 'hours-week-next',
  labelTestID = 'hours-week-label',
}: WeekNavHeaderProps) {
  return (
    <View className="flex-row items-center justify-between">
      <AnimatedPressable
        testID={previousTestID}
        accessibilityRole="button"
        accessibilityLabel={previousAccessibilityLabel}
        accessibilityState={{ disabled: isPreviousDisabled }}
        disabled={isPreviousDisabled}
        haptic={isPreviousDisabled ? 'none' : 'light'}
        scaleIntensity="standard"
        onPress={onPreviousWeek}
        hitSlop={12}
        style={{
          minWidth: spacing.minTouchTarget,
          minHeight: spacing.minTouchTarget,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isPreviousDisabled ? 0.4 : 1,
        }}
      >
        <Icon icon={ChevronLeft} size={20} className="text-foreground" />
      </AnimatedPressable>
      <Small testID={labelTestID} weight="semibold" tabular>
        {label}
      </Small>
      <AnimatedPressable
        testID={nextTestID}
        accessibilityRole="button"
        accessibilityLabel={nextAccessibilityLabel}
        accessibilityState={{ disabled: isNextDisabled }}
        disabled={isNextDisabled}
        haptic={isNextDisabled ? 'none' : 'light'}
        scaleIntensity="standard"
        onPress={onNextWeek}
        hitSlop={12}
        style={{
          minWidth: spacing.minTouchTarget,
          minHeight: spacing.minTouchTarget,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isNextDisabled ? 0.4 : 1,
        }}
      >
        <Icon icon={ChevronRight} size={20} className="text-foreground" />
      </AnimatedPressable>
    </View>
  );
}
