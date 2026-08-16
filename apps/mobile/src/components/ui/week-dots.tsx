/**
 * @module WeekDots
 *
 * 7 small dots, filled for days that have hours. `worked` is Postgres
 * `extract(dow)` indexed (0=Sunday); `weekStartsOn` rotates display only —
 * same contract as WeekStrip. Presentational: no queries, no domain imports.
 */

import { View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

const DOT_SIZE = 8;
const DEFAULT_TEST_ID = 'week-dots';

interface WeekDotsProps {
  /** Presence per Postgres dow (0=Sunday … 6=Saturday). */
  worked: boolean[];
  /** Display-only week start (Postgres dow). Default Monday (1). */
  weekStartsOn?: number;
  testID?: string;
}

export function WeekDots({ worked, weekStartsOn = 1, testID }: WeekDotsProps) {
  const colors = useThemeColors();
  const baseTestID = testID ?? DEFAULT_TEST_ID;
  const displayOrder = getWeekdayOrder(weekStartsOn);

  return (
    <View testID={baseTestID} className="flex-row items-center justify-between">
      {displayOrder.map(dow => {
        const isFilled = worked[dow] === true;
        return (
          <View
            key={dow}
            testID={`${baseTestID}-dot-${dow}`}
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: DOT_SIZE / 2,
              backgroundColor: isFilled ? colors.primary : colors.border,
            }}
          />
        );
      })}
    </View>
  );
}

export type { WeekDotsProps };
