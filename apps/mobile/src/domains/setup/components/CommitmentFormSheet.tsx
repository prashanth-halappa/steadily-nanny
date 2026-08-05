/**
 * @module domains/setup/components/CommitmentFormSheet
 *
 * Add a fixed commitment for a child: kind, label, weekly days, times,
 * excluded_from_cover toggle.
 */
import {
  CHILD_COMMITMENT_KINDS,
  type ChildCommitmentKind,
} from '@steadily-nanny/shared-types/schemas/child.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { FieldLabel } from '@/src/components/ui/field-label';
import { Input } from '@/src/components/ui/input';
import { Switch } from '@/src/components/ui/switch';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { H3 } from '@/src/components/ui/typography';
import { WeekStrip } from '@/src/components/ui/week-strip';
import { commitmentKindLabelKey } from '@/src/domains/setup/constants/commitmentKinds';
import {
  buildWeeklyRrule,
  formatCommitmentTime,
} from '@/src/domains/setup/utils/commitmentRrule';

export interface CommitmentFormValues {
  kind: ChildCommitmentKind;
  label: string;
  days: number[];
  startTime: string;
  endTime: string;
  excludedFromCover: boolean;
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
const DEFAULT_END = '12:00';

export function CommitmentFormSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  childName,
}: CommitmentFormSheetProps) {
  const { t } = useTranslation('household');
  const [kind, setKind] = useState<ChildCommitmentKind>(
    CHILD_COMMITMENT_KINDS.PRESCHOOL
  );
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(DEFAULT_END);
  const [excludedFromCover, setExcludedFromCover] = useState(true);

  useEffect(() => {
    if (visible) {
      setKind(CHILD_COMMITMENT_KINDS.PRESCHOOL);
      setLabel('');
      setDays(DEFAULT_DAYS);
      setStartTime(DEFAULT_START);
      setEndTime(DEFAULT_END);
      setExcludedFromCover(true);
    }
  }, [visible]);

  const toggleDay = (day: number) => {
    setDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const isValid =
    label.trim().length > 0 && days.length > 0 && endTime > startTime;

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit({
      kind,
      label: label.trim(),
      days,
      startTime,
      endTime,
      excludedFromCover,
    });
  };

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
        <H3>{t('commitments.form.title', { childName })}</H3>

        <View className="gap-2">
          <FieldLabel>{t('commitments.form.kindLabel')}</FieldLabel>
          <View
            className="flex-row flex-wrap gap-2"
            testID="commitment-kind-row"
          >
            {(
              Object.values(CHILD_COMMITMENT_KINDS) as ChildCommitmentKind[]
            ).map(k => (
              <Button
                key={k}
                testID={`commitment-kind-${k}`}
                variant={kind === k ? 'default' : 'outline'}
                size="sm"
                onPress={() => setKind(k)}
              >
                <Text>{t(commitmentKindLabelKey(k), { defaultValue: k })}</Text>
              </Button>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <FieldLabel>{t('commitments.form.labelLabel')}</FieldLabel>
          <Input
            testID="commitment-form-label"
            accessibilityLabel={t('commitments.form.labelA11y')}
            value={label}
            onChangeText={setLabel}
            placeholder={t('commitments.form.labelPlaceholder')}
          />
        </View>

        <View className="gap-2">
          <FieldLabel>{t('commitments.form.daysLabel')}</FieldLabel>
          <WeekStrip
            testID="commitment-form-days"
            selected={days}
            onToggle={toggleDay}
          />
        </View>

        <View className="gap-2">
          <FieldLabel>{t('commitments.form.timeLabel')}</FieldLabel>
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

        <View className="flex-row items-center justify-between gap-3">
          <FieldLabel className="mb-0">
            {t('commitments.form.excludedLabel')}
          </FieldLabel>
          <Switch
            testID="commitment-form-excluded"
            checked={excludedFromCover}
            onCheckedChange={setExcludedFromCover}
          />
        </View>

        <Button
          testID="commitment-form-submit"
          onPress={handleSubmit}
          disabled={!isValid || isSubmitting}
        >
          <Text>{t('commitments.form.submit')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}

export { buildWeeklyRrule };
