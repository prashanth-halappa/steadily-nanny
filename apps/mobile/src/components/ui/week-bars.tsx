/**
 * @module WeekBars
 *
 * 7-bar minutes chart for a week. `dayMinutes` is Postgres `extract(dow)`
 * indexed (0=Sunday); `weekStartsOn` rotates display only — same contract
 * as WeekStrip. A zero day still paints a stub so the week never looks
 * broken. Presentational: no queries, no domain imports.
 */

import { View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { MetadataLabel } from '@/src/components/ui/typography';
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

const STUB_HEIGHT = 4;
const MAX_BAR_HEIGHT = 40;
const BAR_WIDTH = 8;
const DEFAULT_TEST_ID = 'week-bars';

interface WeekBarsProps {
  /** Minutes worked per Postgres dow (0=Sunday … 6=Saturday). */
  dayMinutes: number[];
  /** Display-only week start (Postgres dow). Default Monday (1). */
  weekStartsOn?: number;
  /** Postgres dow of today, or null when today is outside this week. */
  todayIndex?: number | null;
  testID?: string;
}

function minutesAt(dayMinutes: number[], dow: number): number {
  const value = dayMinutes[dow];
  return typeof value === 'number' && value > 0 ? value : 0;
}

export function WeekBars({
  dayMinutes,
  weekStartsOn = 1,
  todayIndex = null,
  testID,
}: WeekBarsProps) {
  const colors = useThemeColors();
  const baseTestID = testID ?? DEFAULT_TEST_ID;
  const displayOrder = getWeekdayOrder(weekStartsOn);
  const maxMinutes = Math.max(
    0,
    ...displayOrder.map(dow => minutesAt(dayMinutes, dow))
  );

  const accessibilityLabel = displayOrder
    .map(dow => `${DAY_LABELS[dow] ?? ''} ${minutesAt(dayMinutes, dow)}`)
    .join(', ');

  return (
    <View
      testID={baseTestID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-end justify-between"
    >
      {displayOrder.map(dow => {
        const minutes = minutesAt(dayMinutes, dow);
        const isToday = todayIndex === dow;
        const height =
          minutes <= 0 || maxMinutes <= 0
            ? STUB_HEIGHT
            : Math.max(STUB_HEIGHT, (minutes / maxMinutes) * MAX_BAR_HEIGHT);
        const backgroundColor = isToday
          ? colors.primary
          : minutes <= 0
            ? colors.border
            : colors.muted;

        return (
          <View
            key={dow}
            testID={`${baseTestID}-day-${dow}`}
            accessible={false}
            className="items-center gap-1"
          >
            <View
              testID={`${baseTestID}-bar-${dow}`}
              style={{
                width: BAR_WIDTH,
                height,
                backgroundColor,
                borderRadius: 4,
              }}
            />
            <MetadataLabel className="text-muted-foreground">
              {DAY_LABELS[dow]}
            </MetadataLabel>
          </View>
        );
      })}
    </View>
  );
}

export type { WeekBarsProps };
