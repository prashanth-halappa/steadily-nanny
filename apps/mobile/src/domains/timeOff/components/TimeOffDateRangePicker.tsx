/**
 * @module domains/timeOff/components/TimeOffDateRangePicker
 *
 * A start/end CALENDAR-DATE picker (mode="date", not "time") for a time-off
 * request. The wire format in and out is a nominal "yyyy-mm-dd" calendar
 * date — NEVER a Date object — for the same reason `TimeRangePicker`'s
 * "HH:MM" is nominal: these are dates with no fixed instant attached until
 * `toAllDayRange` (`domains/timeOff/utils/timeOffDate.ts`) converts them to
 * `starts_at`/`ends_at` at submit time. Date objects exist only transiently,
 * at the `@react-native-community/datetimepicker` boundary.
 *
 * An end date before the start (or a start after the end) is REFUSED — the
 * component does not call `onChange` and shows an inline error instead. It
 * never silently swaps the two values. Same shape as `TimeRangePicker`
 * (`src/components/ui/time-range-picker.tsx`), which this is deliberately
 * modelled on.
 *
 * NOTE ON TEST STRATEGY: `@react-native-community/datetimepicker` ships raw
 * Flow-typed `.js` source that `bun:test`'s parser cannot handle, and
 * `mock.module()` cannot prevent that parse attempt (verified against the
 * same issue documented on `time-range-picker.tsx`) — so THIS file cannot be
 * render-tested. Per docs/09-TESTING.md §5 Pattern A,
 * `TimeOffDateRangePicker.test.tsx` falls back to source inspection, while
 * the pure "yyyy-mm-dd" logic lives in the dependency-free
 * `TimeOffDateRangePicker.utils.ts` and IS genuinely unit-tested. Any screen
 * that composes this component mocks the WHOLE FILE (not the native
 * package itself, which can't be mocked away) via
 * `mock.module('@/src/domains/timeOff/components/TimeOffDateRangePicker', ...)`
 * so the real screen can still be render-tested — see
 * `TimeOffRequestForm.test.tsx`.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/src/components/ui/text';
import {
  formatDate,
  isEndOnOrAfterStart,
  parseDate,
} from './TimeOffDateRangePicker.utils';

const DEFAULT_TEST_ID = 'time-off-date-range';

interface TimeOffDateRangePickerProps {
  /** Nominal calendar date, "yyyy-mm-dd". */
  start: string;
  /** Nominal calendar date, "yyyy-mm-dd". */
  end: string;
  onChange: (start: string, end: string) => void;
  testID?: string;
}

export function TimeOffDateRangePicker({
  start,
  end,
  onChange,
  testID,
}: TimeOffDateRangePickerProps) {
  const baseTestID = testID ?? DEFAULT_TEST_ID;
  const [showError, setShowError] = useState(false);

  // The event param's real type lives in the native module's own (untranspilable
  // under bun:test) source — see the module doc comment. We only need `date`.
  const handleStartChange = (_event: unknown, date?: Date) => {
    if (!date) return;
    const nextStart = formatDate(date);
    if (!isEndOnOrAfterStart(nextStart, end)) {
      // Refuse — do not swap, do not report an invalid range upward.
      setShowError(true);
      return;
    }
    setShowError(false);
    onChange(nextStart, end);
  };

  const handleEndChange = (_event: unknown, date?: Date) => {
    if (!date) return;
    const nextEnd = formatDate(date);
    if (!isEndOnOrAfterStart(start, nextEnd)) {
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
          <Text className="mb-1 font-sora-medium text-muted-foreground text-xs">
            Start
          </Text>
          <DateTimePicker
            testID={`${baseTestID}-start`}
            value={parseDate(start)}
            mode="date"
            onChange={handleStartChange}
          />
        </View>
        <View className="flex-1">
          <Text className="mb-1 font-sora-medium text-muted-foreground text-xs">
            End
          </Text>
          <DateTimePicker
            testID={`${baseTestID}-end`}
            value={parseDate(end)}
            mode="date"
            onChange={handleEndChange}
          />
        </View>
      </View>
      {showError && (
        <Text
          testID={`${baseTestID}-error`}
          className="mt-2 text-destructive text-xs"
        >
          End date must not be before the start date.
        </Text>
      )}
    </View>
  );
}

export type { TimeOffDateRangePickerProps };
