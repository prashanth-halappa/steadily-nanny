/**
 * @module domains/today/components/MissedHoursSheet
 *
 * The sheet half of forgotten-clock-in recovery: a date, a start/end
 * `TimeRangePicker` (never free-text HH:MM — same pattern `ExtraShiftScreen`
 * uses), an optional note, then submit via `useCreateRetroactiveEntry`.
 * GOLDEN: `BottomSheetBase`, never a bare RN `Modal` (GOLDEN-FIXES #1).
 *
 * Split out of `AddMissedHoursCard` so its two triggers — the general
 * weekly CTA down in "This week", and `ClockInCard`'s specific
 * already-ended-shift prompt — open the SAME sheet instead of one each.
 * `initialDate`/`initialStart`/`initialEnd` are each caller's best guess
 * (today + 09:00–17:00 for the general case, the shift's own scheduled
 * window for the specific one) — never submitted as-is. "We record what
 * happened, not what was planned" (`today:clockInHint`) applies here too:
 * every field stays editable, and only what she confirms or types is sent.
 *
 * `AddMissedHoursCard` keeps its own gating (`showCta`) and trigger button;
 * this owns only what happens once the sheet is open.
 *
 * Mounted only while open (both callers gate the JSX the same way): RN's
 * `Modal` keeps its children in the tree regardless of its own `visible`
 * prop, so the caller unmounting this component — not just flipping a prop
 * — is what actually removes the sheet's contents from the tree when
 * closed. `visible` is passed as a literal `true` here for that reason.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { DateTimeField } from '@/src/components/ui/date-time-field';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Textarea } from '@/src/components/ui/textarea';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { isEndAfterStart } from '@/src/components/ui/time-range-picker.utils';
import { Body, MetadataLabel, Small } from '@/src/components/ui/typography';
import {
  formatDate,
  parseDate,
} from '@/src/domains/timeOff/components/TimeOffDateRangePicker.utils';
import { describeTimeEntryWriteError } from '@/src/domains/timesheet/utils/timeEntryWriteError';
import { useCreateRetroactiveEntry } from '@/src/hooks/mutations/useCreateRetroactiveEntry';
import { useIsOnline } from '@/src/lib/network';
import { shiftInstantsFromWallClock } from '@/src/lib/wallClock';

interface MissedHoursSheetProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21 bug class). */
  timeZone: string;
  onDismiss: () => void;
  /** Household-local `yyyy-mm-dd` — a starting draft, not a submitted fact. */
  initialDate: string;
  /** `HH:MM`, household-local — a starting draft, not a submitted fact. */
  initialStart: string;
  /** `HH:MM`, household-local — a starting draft, not a submitted fact. */
  initialEnd: string;
}

export function MissedHoursSheet({
  householdId,
  timeZone,
  onDismiss,
  initialDate,
  initialStart,
  initialEnd,
}: MissedHoursSheetProps) {
  const { t } = useTranslation('today');
  const { t: tErrors } = useTranslation('errors');
  const isOnline = useIsOnline();
  const createRetroactiveEntry = useCreateRetroactiveEntry();

  const [date, setDate] = useState(initialDate);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const isRangeValid = isEndAfterStart(start, end);

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
      .then(onDismiss)
      // An overlap names the clashing entry's day and range; everything else
      // gets its specific copy. No "open that entry" action — this sheet
      // has no entry list to open one from, unlike NannyWeekView.
      .catch((error: unknown) => {
        setRefusal(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
            .message
        );
      });
  };

  return (
    <BottomSheetBase
      sheetId="today-missed-hours"
      visible
      onDismiss={onDismiss}
      testID="today-missed-hours-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <Body className="text-muted-foreground">
          {t('missedHours.sheetHint')}
        </Body>
        <MetadataLabel className="text-muted-foreground">
          {t('missedHours.dateLabel')}
        </MetadataLabel>
        <DateTimeField
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
            className="text-error-inline-text"
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
  );
}
