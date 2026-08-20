/**
 * @module domains/pay/components/PayScheduleFields
 *
 * The "Pay schedule" group (082, D-17, T7 reversal, `docs/design/
 * screens-pay-terms.md` §4.3): how often this family pays, and which day.
 * PRESENTATION ONLY — the FLSA weekly overtime engine never reads either
 * field; this is purely "how weeks are grouped for you to look at."
 *
 * Rendered inline, never through `components/ui/select.tsx`'s portal —
 * GOLDEN-FIXES #40's family. Both callers (`PaySetupScreen`, a full screen,
 * and `PayChangeSheet`, a `BottomSheetBase`) can host a portal-rendered Select
 * only some of the time, and a native `Modal` sheet is exactly the case where
 * it silently isn't (`CurrencySelect.tsx`'s module doc). Four/seven plain
 * `Pressable` chips, same pattern as the cancellation chips beside them.
 */

import type { PayFrequency } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { PAY_FREQUENCIES } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { Pressable, View } from 'react-native';
import { cn } from '@/lib/utils';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { Label, Small } from '@/src/components/ui/typography';

const FREQUENCIES: readonly PayFrequency[] = [
  PAY_FREQUENCIES.WEEKLY,
  PAY_FREQUENCIES.BIWEEKLY,
  PAY_FREQUENCIES.SEMIMONTHLY,
  PAY_FREQUENCIES.MONTHLY,
];

function frequencyLabelKey(frequency: PayFrequency): string {
  switch (frequency) {
    case PAY_FREQUENCIES.WEEKLY:
      return 'changeSheet.payFrequencyWeekly';
    case PAY_FREQUENCIES.BIWEEKLY:
      return 'changeSheet.payFrequencyBiweekly';
    case PAY_FREQUENCIES.SEMIMONTHLY:
      return 'changeSheet.payFrequencySemimonthly';
    case PAY_FREQUENCIES.MONTHLY:
      return 'changeSheet.payFrequencyMonthly';
    default:
      return frequency;
  }
}

const WEEKDAY_KEYS = [
  'changeSheet.weekdaySun',
  'changeSheet.weekdayMon',
  'changeSheet.weekdayTue',
  'changeSheet.weekdayWed',
  'changeSheet.weekdayThu',
  'changeSheet.weekdayFri',
  'changeSheet.weekdaySat',
] as const;

interface PayScheduleFieldsProps {
  testIDPrefix: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  payFrequency: PayFrequency | '';
  onPayFrequencyChange: (value: PayFrequency | '') => void;
  payDayOfWeekText: string;
  onPayDayOfWeekTextChange: (value: string) => void;
  payDayOfMonthText: string;
  onPayDayOfMonthTextChange: (value: string) => void;
}

export function PayScheduleFields({
  testIDPrefix,
  t,
  payFrequency,
  onPayFrequencyChange,
  payDayOfWeekText,
  onPayDayOfWeekTextChange,
  payDayOfMonthText,
  onPayDayOfMonthTextChange,
}: PayScheduleFieldsProps) {
  const showWeekdayPicker =
    payFrequency === PAY_FREQUENCIES.WEEKLY ||
    payFrequency === PAY_FREQUENCIES.BIWEEKLY;
  const showDayOfMonthInput =
    payFrequency === PAY_FREQUENCIES.SEMIMONTHLY ||
    payFrequency === PAY_FREQUENCIES.MONTHLY;

  return (
    <View className="gap-2">
      <Label>{t('changeSheet.payScheduleFieldLabel')}</Label>
      <View
        testID={`${testIDPrefix}-pay-frequency-row`}
        className="flex-row flex-wrap gap-2"
      >
        {FREQUENCIES.map(frequency => {
          const selected = payFrequency === frequency;
          return (
            <Pressable
              key={frequency}
              testID={`${testIDPrefix}-pay-frequency-${frequency}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onPayFrequencyChange(selected ? '' : frequency)}
              className={cn(
                'rounded-chip bg-secondary px-3 py-2',
                selected && 'bg-primary'
              )}
            >
              <Text
                className={
                  selected ? 'font-semibold text-primary-foreground' : undefined
                }
              >
                {t(frequencyLabelKey(frequency))}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {showWeekdayPicker ? (
        <View className="gap-2">
          <Label>{t('changeSheet.payDayOfWeekLabel')}</Label>
          <View
            testID={`${testIDPrefix}-pay-day-of-week-row`}
            className="flex-row flex-wrap gap-2"
          >
            {WEEKDAY_KEYS.map((key, day) => {
              const selected = payDayOfWeekText === String(day);
              return (
                <Pressable
                  key={key}
                  testID={`${testIDPrefix}-pay-day-of-week-${day}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() =>
                    onPayDayOfWeekTextChange(selected ? '' : String(day))
                  }
                  className={cn(
                    'rounded-chip bg-secondary px-3 py-2',
                    selected && 'bg-primary'
                  )}
                >
                  <Text
                    className={
                      selected
                        ? 'font-semibold text-primary-foreground'
                        : undefined
                    }
                  >
                    {t(key)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {showDayOfMonthInput ? (
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Input
              testID={`${testIDPrefix}-pay-day-of-month-input`}
              accessibilityLabel={t('changeSheet.payDayOfMonthLabel')}
              value={payDayOfMonthText}
              onChangeText={onPayDayOfMonthTextChange}
              keyboardType="number-pad"
              className="flex-1"
            />
            {payFrequency === PAY_FREQUENCIES.SEMIMONTHLY ? (
              <Small className="text-muted-foreground">
                {t('changeSheet.payDayOfMonthAndLastDay')}
              </Small>
            ) : null}
          </View>
        </View>
      ) : null}

      <Small className="text-muted-foreground">
        {t('changeSheet.payScheduleHint')}
      </Small>
    </View>
  );
}
