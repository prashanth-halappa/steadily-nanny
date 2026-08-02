/**
 * @module domains/timeOff/components/TimeOffRequestForm
 *
 * The request body: a start/end date range plus an optional note, submitted
 * via `useRequestTimeOff`. There is no "pending approval" state anywhere in
 * this flow — `POST /v1/time-off` confirms the request instantly (see
 * `src/api/endpoints/timeOff.ts`'s header comment) — so the success toast
 * says "confirmed", never "requested" or "sent for approval".
 *
 * D30: before mutate, refetch anonymised busy blocks for the selected range.
 * Overlaps with `other_commitment` / `personal` open a warn-and-confirm
 * dialog; a busy-query failure opens an explicit acknowledgement dialog —
 * never silent submit when we could not check. Conflicts never hard-block.
 *
 * `.mutateAsync(...)` is wrapped in try/catch, never a bare `.then()` with
 * no rejection handler — same regression class as D7/`ParentWeekView`'s
 * approve/query handlers (an unhandled promise rejection in metro.log even
 * though the mutation's own `onError` already shows a toast).
 */
import type { CreateCarerTimeOffInput } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body } from '@/src/components/ui/typography';
import { useRequestTimeOff } from '@/src/hooks/mutations/useRequestTimeOff';
import { useBusyBlocks } from '@/src/hooks/queries/useBusyBlocks';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { findConflictingBusyBlocks } from '../utils/busyConflict';
import { toAllDayRange } from '../utils/timeOffDate';
import { TimeOffDateRangePicker } from './TimeOffDateRangePicker';

/** Today's calendar date, "yyyy-mm-dd", in the DEVICE's local zone. */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function TimeOffRequestForm() {
  const { t } = useTranslation('timeOff');
  const requestTimeOff = useRequestTimeOff();
  const userId = useAuthStore(s => s.session?.user?.id ?? null);
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [message, setMessage] = useState('');
  const [conflictOpen, setConflictOpen] = useState(false);
  const [checkFailedOpen, setCheckFailedOpen] = useState(false);
  const [pendingPayload, setPendingPayload] =
    useState<CreateCarerTimeOffInput | null>(null);

  const { starts_at: rangeStart, ends_at: rangeEnd } = toAllDayRange(
    startDate,
    endDate
  );
  const busyQuery = useBusyBlocks(userId, rangeStart, rangeEnd);

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const buildPayload = (): CreateCarerTimeOffInput => {
    const { starts_at, ends_at } = toAllDayRange(startDate, endDate);
    const trimmedMessage = message.trim();
    return {
      starts_at,
      ends_at,
      all_day: true,
      ...(trimmedMessage ? { message: trimmedMessage } : {}),
    };
  };

  const submitPayload = async (payload: CreateCarerTimeOffInput) => {
    try {
      await requestTimeOff.mutateAsync(payload);
    } catch {
      return;
    }
    setMessage('');
    setPendingPayload(null);
    showSuccessToast(t('requestedToast'));
  };

  const handleSubmit = async () => {
    if (requestTimeOff.isPending) return;
    const payload = buildPayload();

    const result = await busyQuery.refetch();
    if (result.error) {
      setPendingPayload(payload);
      setCheckFailedOpen(true);
      return;
    }

    const conflicts = findConflictingBusyBlocks(
      payload.starts_at,
      payload.ends_at,
      result.data ?? []
    );
    if (conflicts.length > 0) {
      setPendingPayload(payload);
      setConflictOpen(true);
      return;
    }

    await submitPayload(payload);
  };

  const confirmPending = () => {
    const payload = pendingPayload;
    if (!payload) return;
    setConflictOpen(false);
    setCheckFailedOpen(false);
    void submitPayload(payload);
  };

  return (
    <View testID="time-off-request-form" className="mb-6 gap-4">
      <Body className="font-medium">{t('requestTitle')}</Body>
      <TimeOffDateRangePicker
        testID="time-off-request-dates"
        start={startDate}
        end={endDate}
        onChange={handleDateChange}
      />
      <Textarea
        testID="time-off-request-message"
        accessibilityLabel={t('messageLabel')}
        placeholder={t('messagePlaceholder')}
        value={message}
        onChangeText={setMessage}
      />
      <Button
        testID="time-off-request-submit"
        disabled={requestTimeOff.isPending}
        onPress={() => void handleSubmit()}
      >
        <Text>{t('requestSubmit')}</Text>
      </Button>

      <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('conflictTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('conflictDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel testID="time-off-conflict-cancel">
              <Text>{t('conflictCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="time-off-conflict-confirm"
              onPress={confirmPending}
            >
              <Text>{t('conflictConfirm')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={checkFailedOpen} onOpenChange={setCheckFailedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('checkFailedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('checkFailedDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel testID="time-off-check-failed-cancel">
              <Text>{t('checkFailedCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="time-off-check-failed-confirm"
              onPress={confirmPending}
            >
              <Text>{t('checkFailedConfirm')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
