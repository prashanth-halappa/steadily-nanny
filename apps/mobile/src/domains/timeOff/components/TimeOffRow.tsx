/**
 * @module domains/timeOff/components/TimeOffRow
 *
 * One time-off booking: date range, StatusPill, optional note, Edit/Cancel.
 * Past rows hide both Edit and Cancel. Cancelled rows stay visible, dimmed.
 *
 * TIER0-CX-SPEC.md §5.2 — `paidFamilyCount` adds one `Small` line under the
 * StatusPill on THIS surface only (`/settings/time-off`, person-scoped,
 * cross-family): "Not marked paid" / "Paid by 1 family" / "Paid by N
 * families" — NEVER a household name and NEVER a per-family amount, on
 * pain of leaking one family's payroll detail to another. `undefined`
 * (the count hasn't resolved yet) renders nothing at all, distinct from a
 * resolved `0` — same "omit while loading, never fabricate a placeholder"
 * discipline as the PTO balance row (`domains/pay/utils/termRows.ts`).
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
  /** Number of DISTINCT households whose `pto_ledger` marks this time off
   * paid — `undefined` while unresolved (renders nothing), a resolved
   * number renders the anonymised marker (TIER0-CX-SPEC.md §5.2). */
  paidFamilyCount?: number;
}

export function TimeOffRow({
  timeOff,
  onCancel,
  onEdit,
  isCancelling,
  isEditing = false,
  paidFamilyCount,
}: TimeOffRowProps) {
  const { t } = useTranslation('timeOff');
  const { t: tPay } = useTranslation('pay');
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
      {timeOff.kind === 'sick' ? (
        <StatusPill
          testID={`time-off-kind-sick-${timeOff.id}`}
          variant="short-notice"
          label={t('kind.sick')}
        />
      ) : null}
      {paidFamilyCount === undefined ? null : (
        <Small
          testID={`time-off-paid-marker-${timeOff.id}`}
          className="text-muted-foreground"
        >
          {paidFamilyCount === 0
            ? tPay('crossFamily.notMarkedPaid')
            : tPay('crossFamily.paidByFamilies', { count: paidFamilyCount })}
        </Small>
      )}
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
