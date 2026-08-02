/**
 * @module domains/timesheet/components/WeekTotal
 * The week's total hours plus a plainly-stated overtime delta, e.g.
 * "9h 14m, +14 min" against what was scheduled — and, when the caller
 * supplies `onPreviousWeek`/`onNextWeek` (D15), the previous/next week
 * navigation controls flanking the week-range label. Nav is optional so
 * existing callers that don't wire it up keep behaving exactly as before.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Card, CardContent } from '@/src/components/ui/card';
import { Body, H2, Small } from '@/src/components/ui/typography';

interface WeekTotalProps {
  totalLabel: string;
  overtimeLabel: string | null;
  weekRangeLabel: string;
  testID?: string;
  /** Omit to render without navigation (backwards compatible). */
  onPreviousWeek?: () => void;
  onNextWeek?: () => void;
  /** Never let navigation reach a week later than the current one. */
  isNextDisabled?: boolean;
  /** Never let navigation page back past the app's bounded history window. */
  isPreviousDisabled?: boolean;
}

export function WeekTotal({
  totalLabel,
  overtimeLabel,
  weekRangeLabel,
  testID,
  onPreviousWeek,
  onNextWeek,
  isNextDisabled = false,
  isPreviousDisabled = false,
}: WeekTotalProps) {
  const { t } = useTranslation('hours');
  const hasNav = !!onPreviousWeek && !!onNextWeek;

  return (
    <Card testID={testID} className="mb-4">
      <CardContent className="gap-1 p-6">
        {hasNav ? (
          <View className="flex-row items-center justify-between">
            <AnimatedPressable
              testID="hours-week-prev"
              accessibilityRole="button"
              accessibilityLabel={t('previousWeek')}
              accessibilityState={{ disabled: isPreviousDisabled }}
              disabled={isPreviousDisabled}
              haptic={isPreviousDisabled ? 'none' : 'light'}
              scaleIntensity="subtle"
              onPress={onPreviousWeek}
              className={isPreviousDisabled ? 'opacity-40' : undefined}
            >
              <Icon icon={ChevronLeft} size={20} className="text-foreground" />
            </AnimatedPressable>
            <Small testID="hours-week-label" className="text-muted-foreground">
              {weekRangeLabel}
            </Small>
            <AnimatedPressable
              testID="hours-week-next"
              accessibilityRole="button"
              accessibilityLabel={t('nextWeek')}
              accessibilityState={{ disabled: isNextDisabled }}
              disabled={isNextDisabled}
              haptic={isNextDisabled ? 'none' : 'light'}
              scaleIntensity="subtle"
              onPress={onNextWeek}
              className={isNextDisabled ? 'opacity-40' : undefined}
            >
              <Icon icon={ChevronRight} size={20} className="text-foreground" />
            </AnimatedPressable>
          </View>
        ) : (
          <Small className="text-muted-foreground">{weekRangeLabel}</Small>
        )}
        <View className="flex-row items-baseline gap-2">
          <H2 testID="hours-total">{totalLabel}</H2>
          {overtimeLabel ? (
            <Body className="text-muted-foreground">{overtimeLabel}</Body>
          ) : null}
        </View>
      </CardContent>
    </Card>
  );
}
