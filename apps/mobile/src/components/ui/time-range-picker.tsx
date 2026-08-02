/**
 * @module TimeRangePicker
 *
 * A start/end 24-hour time picker. The wire format in and out is a nominal
 * "HH:MM" local wall-clock string — NEVER a Date object — because these are
 * shift/pattern times without a fixed date or timezone attached; converting
 * them to Date would reintroduce exactly the timezone drift the shared
 * schema was designed to avoid. Date objects exist only transiently, at the
 * `@react-native-community/datetimepicker` boundary.
 *
 * An end time at or before the start (or a start at or after the end) is
 * REFUSED — the component does not call `onChange` and shows an inline
 * error instead. It never silently swaps the two values.
 *
 * NOTE ON TEST STRATEGY: `@react-native-community/datetimepicker` ships raw
 * Flow-typed `.js` source (no pre-built dist) that `bun:test`'s parser
 * cannot handle — it fails on `import type {...} from './types'` inside a
 * plain `.js` file — and `mock.module()` cannot prevent that parse attempt
 * (verified: it fails identically whether mocked by bare specifier or by
 * resolved absolute path). So this file cannot be render-tested. Per
 * docs/09-TESTING.md §5 Pattern A, `time-range-picker.test.tsx` falls back
 * to source-inspection for the wiring below, while the pure "HH:MM" logic
 * lives in the dependency-free `time-range-picker.utils.ts` and IS
 * genuinely unit-tested (`time-range-picker.utils.test.ts`).
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/src/components/ui/text';
import {
  formatTime,
  isEndAfterStart,
  parseTime,
} from './time-range-picker.utils';

const DEFAULT_TEST_ID = 'time-range-picker';

interface TimeRangePickerProps {
  /** Nominal local wall-clock time, "HH:MM" (24-hour). */
  start: string;
  /** Nominal local wall-clock time, "HH:MM" (24-hour). */
  end: string;
  onChange: (start: string, end: string) => void;
  testID?: string;
}

export function TimeRangePicker({
  start,
  end,
  onChange,
  testID,
}: TimeRangePickerProps) {
  const baseTestID = testID ?? DEFAULT_TEST_ID;
  const [showError, setShowError] = useState(false);

  // The event param's real type lives in the native module's own (untranspilable
  // under bun:test) source — see the module doc comment. We only need `date`.
  const handleStartChange = (_event: unknown, date?: Date) => {
    if (!date) return;
    const nextStart = formatTime(date);
    if (!isEndAfterStart(nextStart, end)) {
      // Refuse — do not swap, do not report an invalid range upward.
      setShowError(true);
      return;
    }
    setShowError(false);
    onChange(nextStart, end);
  };

  const handleEndChange = (_event: unknown, date?: Date) => {
    if (!date) return;
    const nextEnd = formatTime(date);
    if (!isEndAfterStart(start, nextEnd)) {
      // Refuse — do not swap, do not report an invalid range upward.
      setShowError(true);
      return;
    }
    setShowError(false);
    onChange(start, nextEnd);
  };

  return (
    <View testID={baseTestID}>
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="mb-1 font-medium text-muted-foreground text-xs">
            Start
          </Text>
          <DateTimePicker
            testID={`${baseTestID}-start`}
            value={parseTime(start)}
            mode="time"
            is24Hour
            onChange={handleStartChange}
          />
        </View>
        <View className="flex-1">
          <Text className="mb-1 font-medium text-muted-foreground text-xs">
            End
          </Text>
          <DateTimePicker
            testID={`${baseTestID}-end`}
            value={parseTime(end)}
            mode="time"
            is24Hour
            onChange={handleEndChange}
          />
        </View>
      </View>
      {showError && (
        <Text
          testID={`${baseTestID}-error`}
          className="mt-2 text-destructive text-xs"
        >
          End time must be after start time.
        </Text>
      )}
    </View>
  );
}

export type { TimeRangePickerProps };
