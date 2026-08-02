/**
 * @module domains/timeOff/components/TimeOffRequestForm
 *
 * The request body: a start/end date range plus an optional note, submitted
 * via `useRequestTimeOff`. There is no "pending approval" state anywhere in
 * this flow — `POST /v1/time-off` confirms the request instantly (see
 * `src/api/endpoints/timeOff.ts`'s header comment) — so the success toast
 * says "confirmed", never "requested" or "sent for approval".
 *
 * `.mutateAsync(...)` is wrapped in try/catch, never a bare `.then()` with
 * no rejection handler — same regression class as D7/`ParentWeekView`'s
 * approve/query handlers (an unhandled promise rejection in metro.log even
 * though the mutation's own `onError` already shows a toast).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body } from '@/src/components/ui/typography';
import { useRequestTimeOff } from '@/src/hooks/mutations/useRequestTimeOff';
import { showSuccessToast } from '@/src/lib/toast';
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
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [message, setMessage] = useState('');

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleSubmit = async () => {
    if (requestTimeOff.isPending) return;
    const { starts_at, ends_at } = toAllDayRange(startDate, endDate);
    const trimmedMessage = message.trim();
    try {
      await requestTimeOff.mutateAsync({
        starts_at,
        ends_at,
        all_day: true,
        ...(trimmedMessage ? { message: trimmedMessage } : {}),
      });
    } catch {
      return;
    }
    setMessage('');
    showSuccessToast(t('requestedToast'));
  };

  return (
    <View testID="time-off-request-form" className="mb-6 gap-4">
      <Body className="font-sora-medium">{t('requestTitle')}</Body>
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
    </View>
  );
}
