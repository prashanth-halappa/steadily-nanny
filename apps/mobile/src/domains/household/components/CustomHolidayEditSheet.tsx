/**
 * @module domains/household/components/CustomHolidayEditSheet
 *
 * Add/edit a household-authored custom day: a name plus a list of
 * calendar dates. GOLDEN-FIXES #1 — sheets always go through
 * `BottomSheetBase`, never a bare RN `<Modal>`.
 *
 * Date picking follows `ExpenseDateField`: `@react-native-community/datetimepicker`
 * in `mode="date"`, wire format is a nominal "yyyy-mm-dd", and `Date`
 * exists only at the native boundary via `ExpenseDateField.utils`. Future
 * dates are allowed (a holiday can be ahead of today), so there is no
 * `maximumDate`.
 *
 * NOTE ON TEST STRATEGY: `@react-native-community/datetimepicker` ships raw
 * Flow-typed `.js` source `bun:test`'s parser cannot handle, and
 * `mock.module()` cannot prevent that parse attempt — so THIS file cannot be
 * render-tested (docs/09-TESTING.md §5 Pattern A).
 * `CustomHolidayEditSheet.source.test.ts` falls back to source inspection;
 * the pure add/remove/validate logic lives in `customHolidayForm.ts` and IS
 * genuinely unit-tested. `HouseholdHolidaysScreen.test.tsx` mocks this WHOLE
 * FILE so the screen can still be render-tested.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { DateTimeField } from '@/src/components/ui/date-time-field';
import { FieldError } from '@/src/components/ui/field-error';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { H3 } from '@/src/components/ui/typography';
import {
  formatDate,
  parseDate,
} from '@/src/domains/expenses/components/ExpenseDateField.utils';
import type { CustomHolidayDraft } from '../utils/customHolidayForm';
import {
  addCustomHolidayDate,
  CUSTOM_HOLIDAY_NAME_MAX,
  normalizeCustomHolidayName,
  removeCustomHolidayDate,
  sortAndDedupeDates,
  validateCustomHoliday,
} from '../utils/customHolidayForm';

interface CustomHolidayEditSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSave: (draft: CustomHolidayDraft) => void;
  initialName?: string;
  initialDates?: readonly string[];
  /** The rest of the set — the row being edited is omitted by the caller. */
  siblings: readonly CustomHolidayDraft[];
}

export function CustomHolidayEditSheet({
  visible,
  onDismiss,
  onSave,
  initialName = '',
  initialDates = [],
  siblings,
}: CustomHolidayEditSheetProps) {
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const colors = useThemeColors();
  const [name, setName] = useState(initialName);
  const [dates, setDates] = useState<string[]>(() =>
    sortAndDedupeDates(initialDates)
  );

  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setDates(sortAndDedupeDates(initialDates));
  }, [visible, initialName, initialDates]);

  const draft: CustomHolidayDraft = { name, dates };
  const validationError = validateCustomHoliday(draft, siblings);
  const canSave = validationError === null;

  const handleAddDate = () => {
    setDates(prev => addCustomHolidayDate(prev, formatDate(new Date())));
  };

  const handleDateChange = (index: number, date?: Date) => {
    if (!date) return;
    const current = dates[index];
    if (current === undefined) return;
    const formatted = formatDate(date);
    setDates(
      addCustomHolidayDate(removeCustomHolidayDate(dates, current), formatted)
    );
  };

  const handleRemoveDate = (date: string) => {
    setDates(prev => removeCustomHolidayDate(prev, date));
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: normalizeCustomHolidayName(name),
      dates: sortAndDedupeDates(dates),
    });
  };

  return (
    <BottomSheetBase
      sheetId="custom-holiday-edit"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      showCloseButton
      testID="custom-holiday-edit-sheet"
    >
      <View
        className="gap-3 pb-4"
        style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
      >
        <H3>{t('holidays.custom.editTitle')}</H3>

        <View className="gap-2">
          <FieldLabel>{t('holidays.custom.nameLabel')}</FieldLabel>
          <Input
            testID="custom-holiday-name"
            accessibilityLabel={t('holidays.custom.nameLabel')}
            value={name}
            onChangeText={setName}
            maxLength={CUSTOM_HOLIDAY_NAME_MAX}
          />
        </View>

        <View className="gap-2">
          <FieldLabel>{t('holidays.custom.datesLabel')}</FieldLabel>
          {dates.map((date, index) => (
            <View
              key={date}
              className="flex-row items-center justify-between gap-3"
            >
              <DateTimeField
                testID={`custom-holiday-date-${index}`}
                value={parseDate(date)}
                mode="date"
                onChange={(_event: unknown, next?: Date) =>
                  handleDateChange(index, next)
                }
                accentColor={colors.primary}
                textColor={colors.foreground}
                themeVariant="light"
              />
              <Button
                testID={`custom-holiday-remove-date-${index}`}
                variant="ghost"
                size="sm"
                onPress={() => handleRemoveDate(date)}
                accessibilityLabel={t('holidays.custom.removeDate')}
              >
                <Text>{t('holidays.custom.removeDate')}</Text>
              </Button>
            </View>
          ))}
          {dates.length === 0 ? (
            <FieldError testID="custom-holiday-dates-error">
              {t('holidays.custom.datesRequired')}
            </FieldError>
          ) : null}
          <Button
            testID="custom-holiday-add-date"
            variant="outline"
            size="sm"
            onPress={handleAddDate}
          >
            <Text>{t('holidays.custom.addDate')}</Text>
          </Button>
        </View>

        <Button
          testID="custom-holiday-save"
          onPress={handleSave}
          disabled={!canSave}
        >
          <Text>{tCommon('save')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
