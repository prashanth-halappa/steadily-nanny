/**
 * @module WeekStrip
 *
 * A 7-cell day-of-week selector. Display order follows the caller's
 * `weekStartsOn` preference (D29, default Monday = 1) while
 * storing/reporting days in the Postgres `extract(dow)` convention
 * (0=Sunday..6=Saturday). Those two orderings are DELIBERATELY different —
 * the reordering happens only in this component's render, never in the data
 * it's handed or the data it reports back via `onToggle`.
 *
 * Used by parent onboarding ("what does a usual week look like?"), nanny
 * availability, and the schedule views.
 */

import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';
import { MetadataLabel, tabularStyle } from '@/src/components/ui/typography';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

const DAY_LABELS: Record<number, string> = {
  0: 'S',
  1: 'M',
  2: 'T',
  3: 'W',
  4: 'T',
  5: 'F',
  6: 'S',
};

const DEFAULT_TEST_ID = 'week-strip';

function dayOfMonthFromLocalDate(localDate: string): string {
  const day = Number(localDate.slice(8, 10));
  return Number.isNaN(day) ? localDate.slice(8, 10) : String(day);
}

interface WeekStripProps {
  /** Selected days — Postgres `extract(dow)` convention: 0=Sunday..6=Saturday. */
  selected: number[];
  /** Called with the Postgres day-of-week index that was toggled. */
  onToggle: (day: number) => void;
  /** Days that cannot be toggled — rendered muted, non-interactive. */
  disabled?: number[];
  /**
   * Display-only week start (Postgres dow). Default Monday (1). Does not
   * change the integers in `selected` / `onToggle`.
   */
  weekStartsOn?: number | null;
  /**
   * ISO local dates keyed by Postgres dow (0=Sun … 6=Sat). When set, renders
   * tabular day-of-month numerals under each initial.
   */
  weekDates?: Partial<Record<number, string>>;
  /** Highlights today's cell with chipPlum when it is not selected. */
  todayLocalDate?: string;
  testID?: string;
}

export function WeekStrip({
  selected,
  onToggle,
  disabled = [],
  weekStartsOn = 1,
  weekDates,
  todayLocalDate,
  testID,
}: WeekStripProps) {
  const colors = useThemeColors();
  const baseTestID = testID ?? DEFAULT_TEST_ID;
  const displayOrder = getWeekdayOrder(weekStartsOn);

  return (
    <View
      testID={baseTestID}
      className="flex-row items-center justify-between gap-1"
    >
      {displayOrder.map(day => {
        const isSelected = selected.includes(day);
        const isDisabled = disabled.includes(day);
        const localDate = weekDates?.[day];
        const dayOfMonth = localDate
          ? dayOfMonthFromLocalDate(localDate)
          : null;
        const isToday =
          todayLocalDate != null &&
          localDate != null &&
          localDate === todayLocalDate;
        const isTodayUnselected = isToday && !isSelected;

        return (
          <AnimatedPressable
            key={day}
            testID={`${baseTestID}-day-${day}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected, disabled: isDisabled }}
            disabled={isDisabled}
            haptic={isDisabled ? 'none' : 'light'}
            scaleIntensity="subtle"
            onPress={() => {
              if (!isDisabled) onToggle(day);
            }}
            style={
              isTodayUnselected
                ? { backgroundColor: colors.chip.plum }
                : undefined
            }
            className={cn(
              'h-touch w-touch items-center justify-center gap-0.5 rounded-cell',
              isSelected && 'bg-primary',
              isDisabled && 'opacity-40'
            )}
          >
            <MetadataLabel
              className={cn(
                isSelected ? 'text-primary-foreground' : 'text-muted-foreground'
              )}
            >
              {DAY_LABELS[day]}
            </MetadataLabel>
            {dayOfMonth != null ? (
              <Text
                style={tabularStyle}
                className={cn(
                  'text-sm font-medium',
                  isSelected && 'text-primary-foreground',
                  isTodayUnselected && 'text-primary',
                  !isSelected && !isTodayUnselected && 'text-muted-foreground'
                )}
              >
                {dayOfMonth}
              </Text>
            ) : null}
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

export type { WeekStripProps };
