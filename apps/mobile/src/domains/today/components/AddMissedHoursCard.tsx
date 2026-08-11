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
 * NOT overnight-capable, despite building its instants with
 * `shiftInstantsFromWallClock`: submit is gated on a strict end-after-start
 * range, so the builder's next-day roll is unreachable from here. A forgotten
 * overnight session has to be corrected from Hours instead.
 *
 * Stays open on failure so nothing typed is lost on a retry; closes and
 * resets only after a successful submit. The refusal renders INSIDE the
 * sheet (`describeTimeEntryWriteError`): the hook does toast it, but the
 * toast host is another RN `<Modal>` and this sheet is one, so on iOS that
 * toast is not reliably visible — the carer saw nothing at all.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { COVERING_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { isEndAfterStart } from '@/src/components/ui/time-range-picker.utils';
import { Body, Small } from '@/src/components/ui/typography';
import {
  formatDate,
  parseDate,
} from '@/src/domains/timeOff/components/TimeOffDateRangePicker.utils';
import { describeTimeEntryWriteError } from '@/src/domains/timesheet/utils/timeEntryWriteError';
import {
  getWeekDates,
  getWeekStartISO,
} from '@/src/domains/timesheet/utils/week';
import { useCreateRetroactiveEntry } from '@/src/hooks/mutations/useCreateRetroactiveEntry';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { useIsOnline } from '@/src/lib/network';
import {
  shiftInstantsFromWallClock,
  wallClockToUtcIso,
} from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';

const COVERING_STATUS_SET = new Set<string>(COVERING_SHIFT_STATUSES);

function hasMissedHoursDay(
  shifts: readonly Shift[],
  entries: readonly TimeEntry[],
  currentUserId: string,
  weekDates: readonly string[]
): boolean {
  const entryDates = new Set(
    entries
      .filter(
        entry => entry.carer_id === currentUserId && entry.status !== 'voided'
      )
      .map(entry => entry.local_date)
  );
  return shifts.some(
    shift =>
      COVERING_STATUS_SET.has(shift.status) &&
      shift.carer_id === currentUserId &&
      weekDates.includes(shift.local_date) &&
      !entryDates.has(shift.local_date)
  );
}

interface AddMissedHoursCardProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21 bug class). */
  timeZone: string;
  /** Household `week_starts_on` (0=Sunday..6=Saturday) — which days count as
   * "this week" for a missed-hours prompt is the household's business week,
   * not a hardcoded Monday. */
  weekStartsOn: number;
}

export function AddMissedHoursCard({
  householdId,
  timeZone,
  weekStartsOn,
}: AddMissedHoursCardProps) {
  const { t } = useTranslation('today');
  const { t: tErrors } = useTranslation('errors');
  const isOnline = useIsOnline();
  const createRetroactiveEntry = useCreateRetroactiveEntry();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone, weekStartsOn),
    [timeZone, weekStartsOn]
  );
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEndExclusive = useMemo(
    () => addLocalDays(weekDates[weekDates.length - 1] ?? weekStart, 1),
    [weekDates, weekStart]
  );
  const from = useMemo(
    () => wallClockToUtcIso(weekStart, '00:00', timeZone),
    [weekStart, timeZone]
  );
  const to = useMemo(
    () => wallClockToUtcIso(weekEndExclusive, '00:00', timeZone),
    [weekEndExclusive, timeZone]
  );
  const entriesQuery = useWeekTimeEntries(householdId, weekStart);
  const shiftsQuery = useShiftsRange(householdId, from, to);
  const showCta = useMemo(() => {
    if (!currentUserId) return false;
    if (
      entriesQuery.isLoading ||
      entriesQuery.isPending ||
      shiftsQuery.isLoading ||
      shiftsQuery.isPending
    ) {
      return false;
    }
    return hasMissedHoursDay(
      shiftsQuery.data ?? [],
      entriesQuery.data ?? [],
      currentUserId,
      weekDates
    );
  }, [
    currentUserId,
    entriesQuery.data,
    entriesQuery.isLoading,
    entriesQuery.isPending,
    shiftsQuery.data,
    shiftsQuery.isLoading,
    shiftsQuery.isPending,
    weekDates,
  ]);

  const [visible, setVisible] = useState(false);
  const [date, setDate] = useState(() => localDateInZone(timeZone));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const isRangeValid = isEndAfterStart(start, end);

  const openSheet = () => {
    setDate(localDateInZone(timeZone));
    setStart('09:00');
    setEnd('17:00');
    setNote('');
    setRefusal(null);
    setVisible(true);
  };

  const handleDateChange = (_event: unknown, next?: Date) => {
    if (!next) return;
    setDate(formatDate(next));
  };

  const handleSubmit = () => {
    if (createRetroactiveEntry.isPending) return;
    setRefusal(null);
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
      // An overlap names the clashing entry's day and range; everything else
      // gets its specific copy. No "open that entry" action — this screen
      // has no entry list to open one from, unlike NannyWeekView.
      .catch((error: unknown) => {
        setRefusal(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
            .message
        );
      });
  };

  if (!showCta) {
    return null;
  }

  return (
    <Fragment>
      {/* A recovery affordance, not a peer of "Clock in" — left-aligned
          and Small so it reads as a link, not a centred section heading,
          and pulled tight (-mt-2) under the clock card above it rather
          than orphaned in the gap between the two. */}
      <Button
        testID="today-missed-hours-cta"
        variant="ghost"
        className="-mt-2 self-start px-0"
        onPress={openSheet}
      >
        <Small className="text-primary">{t('missedHours.cta')}</Small>
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
            {refusal ? (
              <Small
                testID="today-missed-hours-error"
                className="text-destructive"
              >
                {refusal}
              </Small>
            ) : null}
            <LoadingButton
              testID="today-missed-hours-submit"
              label={t('missedHours.submit')}
              isLoading={createRetroactiveEntry.isPending}
              disabled={!isRangeValid}
              onPress={handleSubmit}
            />
          </View>
        </BottomSheetBase>
      ) : null}
    </Fragment>
  );
}
