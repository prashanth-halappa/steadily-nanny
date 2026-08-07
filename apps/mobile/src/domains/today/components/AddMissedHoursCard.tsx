/**
 * @module domains/today/components/AddMissedHoursCard
 *
 * Forgotten clock-in recovery: a slim CTA on the carer's Today screen opens
 * a `BottomSheetBase` sheet with a date (defaults to today, household
 * zone), a start/end `TimeRangePicker` (never free-text HH:MM — same
 * pattern `ExtraShiftScreen` uses), and an optional note, then submits via
 * `useCreateRetroactiveEntry`. GOLDEN: BottomSheetBase, never a bare RN
 * Modal (GOLDEN-FIXES #1).
 *
 * Overnight-aware: `shiftInstantsFromWallClock` rolls a finish at or before
 * the start onto the next calendar day — the same builder ShiftDetailScreen
 * and ClockOutSheet use, so a forgotten overnight session resolves the same
 * way everywhere in this app.
 *
 * Stays open on failure (overlap, week already approved, or a span crossing
 * the week boundary all come back as ordinary mutation errors, toasted by
 * `useCreateRetroactiveEntry` itself) so nothing typed is lost on a retry;
 * closes and resets only after a successful submit.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { Body } from '@/src/components/ui/typography';
import {
  formatDate,
  parseDate,
} from '@/src/domains/timeOff/components/TimeOffDateRangePicker.utils';
import { useCreateRetroactiveEntry } from '@/src/hooks/mutations/useCreateRetroactiveEntry';
import { localDateInZone } from '@/src/lib/localDate';
import { shiftInstantsFromWallClock } from '@/src/lib/wallClock';

interface AddMissedHoursCardProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21 bug class). */
  timeZone: string;
}

export function AddMissedHoursCard({
  householdId,
  timeZone,
}: AddMissedHoursCardProps) {
  const { t } = useTranslation('today');
  const createRetroactiveEntry = useCreateRetroactiveEntry();

  const [visible, setVisible] = useState(false);
  const [date, setDate] = useState(() => localDateInZone(timeZone));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [note, setNote] = useState('');

  const openSheet = () => {
    setDate(localDateInZone(timeZone));
    setStart('09:00');
    setEnd('17:00');
    setNote('');
    setVisible(true);
  };

  const handleDateChange = (_event: unknown, next?: Date) => {
    if (!next) return;
    setDate(formatDate(next));
  };

  const handleSubmit = () => {
    if (createRetroactiveEntry.isPending) return;
    const { starts_at, ends_at } = shiftInstantsFromWallClock(
      date,
      start,
      end,
      timeZone
    );
    const trimmedNote = note.trim();
    createRetroactiveEntry
      .mutateAsync({
        household_id: householdId,
        clock_in_at: starts_at,
        clock_out_at: ends_at,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      })
      .then(() => setVisible(false))
      // useCreateRetroactiveEntry's onError already toasts — caught here
      // only so the sheet stays open (note/times preserved) rather than an
      // unhandled promise rejection.
      .catch(() => undefined);
  };

  return (
    <Card testID="today-missed-hours-card" className="gap-2 p-5.5">
      <Body weight="semibold">{t('missedHours.sheetTitle')}</Body>
      <Button
        testID="today-missed-hours-cta"
        variant="ghost"
        onPress={openSheet}
      >
        <Text className="text-primary">{t('missedHours.cta')}</Text>
      </Button>
      {/*
        Mounted only while open, same as ClockInCard's ClockOutSheet — RN's
        `Modal` keeps its children in the render tree regardless of its own
        `visible` prop, so gating the JSX here (not just passing `visible`
        through) is what actually removes the sheet's contents from the tree
        when closed.
      */}
      {visible ? (
        <BottomSheetBase
          sheetId="today-missed-hours"
          visible={visible}
          onDismiss={() => setVisible(false)}
          testID="today-missed-hours-sheet"
          fitContent
          showCloseButton
        >
          <View className="gap-4 px-6 pb-4">
            <Body className="text-muted-foreground">
              {t('missedHours.sheetHint')}
            </Body>
            <Text className="font-medium text-muted-foreground text-xs">
              {t('missedHours.dateLabel')}
            </Text>
            <DateTimePicker
              testID="today-missed-hours-date"
              mode="date"
              value={parseDate(date)}
              onChange={handleDateChange}
            />
            <TimeRangePicker
              testID="today-missed-hours-times"
              start={start}
              end={end}
              onChange={(nextStart, nextEnd) => {
                setStart(nextStart);
                setEnd(nextEnd);
              }}
            />
            <Textarea
              testID="today-missed-hours-note"
              accessibilityLabel={t('missedHours.noteLabel')}
              value={note}
              onChangeText={setNote}
              placeholder={t('missedHours.notePlaceholder')}
            />
            <LoadingButton
              testID="today-missed-hours-submit"
              label={t('missedHours.submit')}
              isLoading={createRetroactiveEntry.isPending}
              onPress={handleSubmit}
            />
          </View>
        </BottomSheetBase>
      ) : null}
    </Card>
  );
}
