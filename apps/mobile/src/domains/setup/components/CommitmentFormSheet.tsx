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
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Switch } from '@/src/components/ui/switch';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { H3 } from '@/src/components/ui/typography';
import { WeekStrip } from '@/src/components/ui/week-strip';
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

const KIND_LABELS: Record<ChildCommitmentKind, string> = {
  preschool: 'Preschool',
  school: 'School',
  activity: 'Activity',
  nap: 'Nap',
  other: 'Other',
};

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
      <View className="gap-3 px-6 pb-4">
        <H3>Add commitment for {childName}</H3>

        <View className="gap-2">
          <Label>Kind</Label>
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
                <Text>{KIND_LABELS[k]}</Text>
              </Button>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Label>Label</Label>
          <Input
            testID="commitment-form-label"
            accessibilityLabel="Commitment label"
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Preschool drop-off"
          />
        </View>

        <View className="gap-2">
          <Label>Days</Label>
          <WeekStrip
            testID="commitment-form-days"
            selected={days}
            onToggle={toggleDay}
          />
        </View>

        <View className="gap-2">
          <Label>Time</Label>
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
          <Label>Excluded from cover</Label>
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
          <Text>Add commitment</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}

export { buildWeeklyRrule };
