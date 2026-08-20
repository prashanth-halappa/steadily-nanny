/**
 * @module domains/timeOff/components/TimeOffRequestForm
 *
 * The request body: a start/end date range plus an optional note, submitted
 * via `useRequestTimeOff` (create) or `useUpdateTimeOff` (edit). There is no
 * "pending approval" state anywhere in this flow — `POST /v1/time-off`
 * confirms the request instantly (see `src/api/endpoints/timeOff.ts`'s header
 * comment) — so the success toast says "confirmed", never "requested" or
 * "sent for approval".
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
import type {
  CarerTimeOff,
  CreateCarerTimeOffInput,
  UpdateCarerTimeOffInput,
} from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { UseMutationResult } from '@tanstack/react-query';
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
import { FieldLabel } from '@/src/components/ui/field-label';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body } from '@/src/components/ui/typography';
import { useRequestTimeOff } from '@/src/hooks/mutations/useRequestTimeOff';
import type { UpdateTimeOffVariables } from '@/src/hooks/mutations/useUpdateTimeOff';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useBusyBlocks } from '@/src/hooks/queries/useBusyBlocks';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { findConflictingBusyBlocks } from '../utils/busyConflict';
import { fromAllDayRange, toAllDayRange, todayISO } from '../utils/timeOffDate';
import { TimeOffDateRangePicker } from './TimeOffDateRangePicker';
import { isEndOnOrAfterStart } from './TimeOffDateRangePicker.utils';

interface TimeOffRequestFormProps {
  editTimeOff?: CarerTimeOff;
  onEditDismiss?: () => void;
  /** Parent-owned update mutation — Screen passes its single `useUpdateTimeOff` instance. */
  updateTimeOff?: Pick<
    UseMutationResult<CarerTimeOff, Error, UpdateTimeOffVariables>,
    'mutateAsync' | 'isPending'
  >;
}

export function TimeOffRequestForm({
  editTimeOff,
  onEditDismiss,
  updateTimeOff,
}: TimeOffRequestFormProps = {}) {
  const isEditMode = editTimeOff != null;
  const { household } = useActiveHousehold();
  const timeZone = household?.timezone;
  const initialDates = isEditMode
    ? fromAllDayRange(editTimeOff.starts_at, editTimeOff.ends_at, timeZone)
    : {
        startDate: todayISO(new Date(), timeZone),
        endDate: todayISO(new Date(), timeZone),
      };

  const { t } = useTranslation('timeOff');
  const requestTimeOff = useRequestTimeOff();
  const userId = useAuthStore(s => s.session?.user?.id ?? null);
  const [startDate, setStartDate] = useState(initialDates.startDate);
  const [endDate, setEndDate] = useState(initialDates.endDate);
  const [message, setMessage] = useState(editTimeOff?.message ?? '');
  const [conflictOpen, setConflictOpen] = useState(false);
  const [checkFailedOpen, setCheckFailedOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<
    CreateCarerTimeOffInput | UpdateCarerTimeOffInput | null
  >(null);

  const activeMutation = isEditMode ? updateTimeOff : requestTimeOff;

  if (isEditMode && !updateTimeOff) {
    throw new Error(
      'TimeOffRequestForm edit mode requires updateTimeOff from parent'
    );
  }

  const { starts_at: rangeStart, ends_at: rangeEnd } = toAllDayRange(
    startDate,
    endDate,
    timeZone
  );
  const dateRangeValid = isEndOnOrAfterStart(startDate, endDate);
  const busyQuery = useBusyBlocks(
    userId,
    dateRangeValid ? rangeStart : null,
    dateRangeValid ? rangeEnd : null
  );

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const buildPayload = ():
    | CreateCarerTimeOffInput
    | UpdateCarerTimeOffInput => {
    const { starts_at, ends_at } = toAllDayRange(startDate, endDate, timeZone);
    const trimmedMessage = message.trim();
    if (isEditMode) {
      return {
        starts_at,
        ends_at,
        all_day: true,
        message: trimmedMessage || null,
      };
    }
    return {
      starts_at,
      ends_at,
      all_day: true,
      ...(trimmedMessage ? { message: trimmedMessage } : {}),
    };
  };

  const submitPayload = async (
    payload: CreateCarerTimeOffInput | UpdateCarerTimeOffInput
  ) => {
    try {
      if (isEditMode && editTimeOff && updateTimeOff) {
        await updateTimeOff.mutateAsync({ id: editTimeOff.id, input: payload });
      } else {
        await requestTimeOff.mutateAsync(payload as CreateCarerTimeOffInput);
      }
    } catch {
      return;
    }
    if (!isEditMode) {
      setMessage('');
    }
    setPendingPayload(null);
    showSuccessToast(t(isEditMode ? 'updatedToast' : 'requestedToast'));
    onEditDismiss?.();
  };

  const handleSubmit = async () => {
    if (activeMutation?.isPending) return;
    const payload = buildPayload();

    const result = await busyQuery.refetch();
    if (result.error) {
      setPendingPayload(payload);
      setCheckFailedOpen(true);
      return;
    }

    const conflicts = findConflictingBusyBlocks(
      payload.starts_at ?? rangeStart,
      payload.ends_at ?? rangeEnd,
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
    <View
      testID={isEditMode ? 'time-off-edit-form' : 'time-off-request-form'}
      className="gap-4"
    >
      {isEditMode ? <Body weight="medium">{t('editTitle')}</Body> : null}
      <TimeOffDateRangePicker
        testID="time-off-request-dates"
        start={startDate}
        end={endDate}
        onChange={handleDateChange}
      />
      <View className="gap-1">
        <FieldLabel>{t('messageLabel')}</FieldLabel>
        <Textarea
          testID="time-off-request-message"
          accessibilityLabel={t('messageLabel')}
          placeholder={t('messagePlaceholder')}
          value={message}
          onChangeText={setMessage}
          className="border-input bg-card"
        />
      </View>
      {isEditMode ? (
        <View className="flex-row gap-2">
          <Button
            testID="time-off-edit-cancel"
            variant="ghost"
            disabled={activeMutation?.isPending ?? false}
            onPress={() => onEditDismiss?.()}
          >
            <Text>{t('editCancel')}</Text>
          </Button>
          <Button
            testID="time-off-edit-submit"
            className="flex-1"
            disabled={!dateRangeValid || (activeMutation?.isPending ?? false)}
            onPress={() => void handleSubmit()}
          >
            <Text>{t('editSubmit')}</Text>
          </Button>
        </View>
      ) : (
        <Button
          testID="time-off-request-submit"
          className="w-full"
          disabled={!dateRangeValid || (activeMutation?.isPending ?? false)}
          onPress={() => void handleSubmit()}
        >
          <Text>{t('requestSubmit')}</Text>
        </Button>
      )}

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
