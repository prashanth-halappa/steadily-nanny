/**
 * @module domains/timeOff/components/TimeOffRow
 *
 * One time-off booking: date range, StatusPill, optional note, Edit/Cancel.
 * Past rows hide both Edit and Cancel. Cancelled rows stay visible, dimmed.
 */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { CARER_TIME_OFF_STATUSES } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { formatTimeOffRangeLabel, isPastTimeOff } from '../utils/timeOffDate';

interface TimeOffRowProps {
  timeOff: CarerTimeOff;
  onCancel: (id: string) => void;
  onEdit?: (id: string) => void;
  isCancelling: boolean;
  isEditing?: boolean;
}

export function TimeOffRow({
  timeOff,
  onCancel,
  onEdit,
  isCancelling,
  isEditing = false,
}: TimeOffRowProps) {
  const { t } = useTranslation('timeOff');
  const isCancelled = timeOff.status === CARER_TIME_OFF_STATUSES.CANCELLED;
  const isPast = isPastTimeOff(timeOff.ends_at);
  const isEditable = !isCancelled && !isPast;
  const isCancellable = !isCancelled && !isPast;
  const pillVariant = isCancelled ? 'cancelled' : 'confirmed';

  return (
    <Card
      testID={`time-off-row-${timeOff.id}`}
      className={isCancelled ? 'mb-3 gap-1 p-4 opacity-50' : 'mb-3 gap-1 p-4'}
    >
      <Body>{formatTimeOffRangeLabel(timeOff.starts_at, timeOff.ends_at)}</Body>
      <StatusPill
        testID={`time-off-status-${timeOff.id}`}
        variant={pillVariant}
        label={t(`status.${timeOff.status}`)}
      />
      {timeOff.message ? (
        <Small className="text-muted-foreground">{timeOff.message}</Small>
      ) : null}
      {isCancellable || isEditable ? (
        <View className="mt-2 flex-row gap-2">
          {onEdit && isEditable ? (
            <Button
              testID={`time-off-edit-${timeOff.id}`}
              variant="ghost"
              disabled={isEditing}
              onPress={() => onEdit(timeOff.id)}
            >
              <Text className="text-primary">{t('editButton')}</Text>
            </Button>
          ) : null}
          {isCancellable ? (
            <Button
              testID={`time-off-cancel-${timeOff.id}`}
              variant="ghost"
              disabled={isCancelling}
              onPress={() => onCancel(timeOff.id)}
            >
              <Text className="text-destructive">{t('cancelButton')}</Text>
            </Button>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
