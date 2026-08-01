/**
 * @module WeekStrip
 *
 * A 7-cell day-of-week selector, displayed Monday-first (en-GB) while
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
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

/** Render order, Monday-first. Values are Postgres `extract(dow)` indices. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

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

interface WeekStripProps {
  /** Selected days — Postgres `extract(dow)` convention: 0=Sunday..6=Saturday. */
  selected: number[];
  /** Called with the Postgres day-of-week index that was toggled. */
  onToggle: (day: number) => void;
  /** Days that cannot be toggled — rendered muted, non-interactive. */
  disabled?: number[];
  testID?: string;
}

export function WeekStrip({
  selected,
  onToggle,
  disabled = [],
  testID,
}: WeekStripProps) {
  const baseTestID = testID ?? DEFAULT_TEST_ID;

  return (
    <View
      testID={baseTestID}
      className="flex-row items-center justify-between gap-1"
    >
      {DISPLAY_ORDER.map(day => {
        const isSelected = selected.includes(day);
        const isDisabled = disabled.includes(day);

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
            className={cn(
              'h-touch w-touch items-center justify-center rounded-full',
              isSelected ? 'bg-primary' : 'bg-muted',
              isDisabled && 'opacity-40'
            )}
          >
            <Text
              className={cn(
                'font-sora-medium text-sm',
                isSelected ? 'text-primary-foreground' : 'text-foreground'
              )}
            >
              {DAY_LABELS[day]}
            </Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

export type { WeekStripProps };
