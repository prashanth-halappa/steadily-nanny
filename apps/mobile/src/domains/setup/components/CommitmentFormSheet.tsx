/**
 * @module domains/setup/components/CommitmentFormSheet
 *
 * Add recurring care hours for a child: weekly days, time range, optional label.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { Body, H3, Small } from '@/src/components/ui/typography';
import { WeekStrip } from '@/src/components/ui/week-strip';
import { formatCareHoursReadback } from '@/src/domains/setup/utils/careHoursDisplay';
import {
  buildWeeklyRrule,
  formatCommitmentTime,
} from '@/src/domains/setup/utils/commitmentRrule';

export interface CommitmentFormValues {
  label: string;
  days: number[];
  startTime: string;
  endTime: string;
}

interface CommitmentFormSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (values: CommitmentFormValues) => void;
  isSubmitting?: boolean;
  childName: string;
}

const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

export function CommitmentFormSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  childName,
}: CommitmentFormSheetProps) {
  const { t } = useTranslation('household');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(DEFAULT_END);

  useEffect(() => {
    if (visible) {
      setLabel('');
      setDays(DEFAULT_DAYS);
      setStartTime(DEFAULT_START);
      setEndTime(DEFAULT_END);
    }
  }, [visible]);

  const toggleDay = (day: number) => {
    setDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const isValid = days.length > 0 && endTime > startTime;

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit({
      label: label.trim(),
      days,
      startTime,
      endTime,
    });
  };

  const readback = isValid
    ? formatCareHoursReadback(startTime, endTime, days, childName, t)
    : null;

  return (
    <BottomSheetBase
      sheetId="commitment-form"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      testID="commitment-form-sheet"
    >
      <View
        className="gap-3 pb-4"
        style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
      >
        <H3>{t('careHours.form.addTitle', { childName })}</H3>
        <Small className="text-muted-foreground">
          {t('careHours.form.intro')}
        </Small>

        <View className="gap-2">
          <FieldLabel>{t('careHours.form.daysLabel')}</FieldLabel>
          <WeekStrip
            testID="commitment-form-days"
            selected={days}
            onToggle={toggleDay}
          />
        </View>

        <View className="gap-2">
          <FieldLabel>{t('careHours.form.timeLabel')}</FieldLabel>
          <TimeRangePicker
            testID="commitment-form-time"
            start={startTime}
            end={endTime}
            onChange={(start, end) => {
              setStartTime(formatCommitmentTime(start));
              setEndTime(formatCommitmentTime(end));
            }}
          />
        </View>

        <View className="gap-2">
          <FieldLabel>{t('careHours.form.labelLabel')}</FieldLabel>
          <Input
            testID="commitment-form-label"
            accessibilityLabel={t('careHours.form.labelA11y')}
            value={label}
            onChangeText={setLabel}
            placeholder={t('careHours.form.labelPlaceholder')}
          />
          <Small className="text-muted-foreground">
            {t('careHours.form.labelHelper')}
          </Small>
        </View>

        {readback ? (
          <Body
            testID="commitment-form-readback"
            className="text-muted-foreground"
          >
            {readback}
          </Body>
        ) : null}

        <Button
          testID="commitment-form-submit"
          onPress={handleSubmit}
          disabled={!isValid || isSubmitting}
        >
          <Text>{t('careHours.form.submit')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}

export { buildWeeklyRrule };
