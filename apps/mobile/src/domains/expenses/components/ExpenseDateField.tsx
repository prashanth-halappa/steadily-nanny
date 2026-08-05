/**
 * @module domains/expenses/components/ExpenseDateField
 *
 * A single CALENDAR-DATE picker (mode="date", not "time") for the expense
 * add/edit sheet — TIER0-CX-SPEC.md §6.1: "Date — defaults to today; an
 * `HH:MM`-style typed control is not needed here, a date row consistent
 * with `TimeOffDateRangePicker` is." This is that same date-row treatment,
 * but for ONE date rather than a start/end range.
 *
 * The wire format in and out is a nominal "yyyy-mm-dd" calendar date, never
 * a Date object — Date only exists transiently at the
 * `@react-native-community/datetimepicker` boundary (`ExpenseDateField.utils.ts`).
 *
 * A future date is REFUSED — the component does not call `onChange` and
 * shows an inline error instead, same discipline as
 * `TimeOffDateRangePicker`'s refuse-don't-swap contract.
 *
 * NOTE ON TEST STRATEGY: `@react-native-community/datetimepicker` ships raw
 * Flow-typed `.js` source `bun:test`'s parser cannot handle, and
 * `mock.module()` cannot prevent that parse attempt — so THIS file cannot be
 * render-tested (docs/09-TESTING.md §5 Pattern A). `ExpenseDateField.test.tsx`
 * falls back to source inspection; the pure "yyyy-mm-dd" logic lives in the
 * dependency-free `ExpenseDateField.utils.ts` and IS genuinely unit-tested.
 * `ExpenseAddSheet.test.tsx` mocks this WHOLE FILE (not the native package,
 * which can't be mocked away) so the sheet itself can still be
 * render-tested — see `TimeOffScreen.test.tsx` for the identical pattern.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { FieldError } from '@/src/components/ui/field-error';
import { FieldLabel } from '@/src/components/ui/field-label';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';
import {
  formatDate,
  isOnOrBeforeToday,
  parseDate,
} from './ExpenseDateField.utils';

const DEFAULT_TEST_ID = 'expense-date-field';

interface ExpenseDateFieldProps {
  /** Nominal calendar date, "yyyy-mm-dd". */
  value: string;
  /** Household-local "today", "yyyy-mm-dd" — a later date is refused. */
  todayISO: string;
  onChange: (value: string) => void;
  testID?: string;
}

export function ExpenseDateField({
  value,
  todayISO,
  onChange,
  testID,
}: ExpenseDateFieldProps) {
  const { t } = useTranslation('expenses');
  const colors = useThemeColors();
  const baseTestID = testID ?? DEFAULT_TEST_ID;
  const [showError, setShowError] = useState(false);

  // The event param's real type lives in the native module's own
  // (untranspilable under bun:test) source — see the module doc comment.
  // Only `date` is needed here.
  const handleChange = (_event: unknown, date?: Date) => {
    if (!date) return;
    const next = formatDate(date);
    if (!isOnOrBeforeToday(next, todayISO)) {
      // Refuse — do not silently clamp to today, do not report a bad date
      // upward.
      setShowError(true);
      return;
    }
    setShowError(false);
    onChange(next);
  };

  return (
    <View testID={baseTestID}>
      <FieldLabel>{t('addSheet.dateLabel')}</FieldLabel>
      <DateTimePicker
        testID={`${baseTestID}-picker`}
        value={parseDate(value)}
        mode="date"
        maximumDate={parseDate(todayISO)}
        onChange={handleChange}
        accentColor={colors.primary}
        textColor={colors.foreground}
        themeVariant="light"
      />
      {showError ? (
        <FieldError testID={`${baseTestID}-error`}>
          {t('addSheet.dateFutureError')}
        </FieldError>
      ) : null}
    </View>
  );
}

export type { ExpenseDateFieldProps };
