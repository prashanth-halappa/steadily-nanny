/**
 * @module domains/timeOff/components/TimeOffRow
 *
 * One time-off request: its date range (en-GB "Mon 4 Aug" style, via
 * `formatTimeOffRangeLabel`), status, optional note, and a Cancel button —
 * hidden once the row is already `cancelled` (cancelling twice is a no-op
 * the API would 200 on harmlessly, but showing the control at all implies
 * there's still something to do).
 *
 * DELIBERATE CHOICE: cancelled rows stay in the list, dimmed, rather than
 * disappearing. `DELETE /v1/time-off/:id` is a soft-cancel — the row and
 * its history persist server-side (see `src/api/endpoints/timeOff.ts`'s
 * header comment) — so hiding it client-side would make the app's record
 * of what happened less complete than what the API actually keeps. A
 * carer's own history of "I asked for this, then cancelled it" is exactly
 * the kind of thing this app's whole pitch (a trustworthy record) implies
 * should stay visible, not vanish.
 *
 * Status is always `'confirmed'` in practice — see
 * `src/api/endpoints/timeOff.ts`'s header comment: there is no approval
 * step, so `'requested'` never actually appears client-side today. The
 * label still renders whatever status the row carries rather than
 * hardcoding "Confirmed", so this doesn't silently go stale if that changes.
 */

import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { CARER_TIME_OFF_STATUSES } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
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
  const isCancellable = !isCancelled;
  const isEditable = isCancellable && !isPastTimeOff(timeOff.ends_at);

  return (
    <Card
      testID={`time-off-row-${timeOff.id}`}
      className={isCancelled ? 'mb-3 opacity-50' : 'mb-3'}
    >
      <CardContent className="gap-1 p-4">
        <Body>
          {formatTimeOffRangeLabel(timeOff.starts_at, timeOff.ends_at)}
        </Body>
        <Small
          testID={`time-off-status-${timeOff.id}`}
          className="text-muted-foreground"
        >
          {t(`status.${timeOff.status}`)}
        </Small>
        {timeOff.message ? (
          <Small className="text-muted-foreground">{timeOff.message}</Small>
        ) : null}
        {isCancellable ? (
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
            <Button
              testID={`time-off-cancel-${timeOff.id}`}
              variant="ghost"
              disabled={isCancelling}
              onPress={() => onCancel(timeOff.id)}
            >
              <Text className="text-destructive">{t('cancelButton')}</Text>
            </Button>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}
