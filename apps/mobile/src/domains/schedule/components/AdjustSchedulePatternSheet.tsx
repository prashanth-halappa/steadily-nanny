/**
 * @module domains/schedule/components/AdjustSchedulePatternSheet
 *
 * "Adjust schedule" sheet for an ACCEPTED pattern — offers exactly the
 * amendment kinds `schedulePatternCommandService.amend` supports that a
 * parent reaches for on an already-accepted week: skip a whole week
 * (`pause_ranges`, e.g. a school holiday) and change or remove the end date
 * (`until`). The server has NO post-accept day/time amend (see
 * `AmendSchedulePatternSchema`'s doc comment in the shared schema) — a
 * day/time change always means building and sending a new usual week, and
 * this sheet says so up front rather than implying otherwise.
 *
 * Sheet-owns-values, screen-owns-mutation (the `ClockOutSheet`/
 * `MarkTimeOffPaidSheet` discipline): this component only builds and
 * reports an `AmendSchedulePatternInput` via `onSubmit`; the caller decides
 * whether/when to close the sheet and dispatches the mutation.
 *
 * Setting a NEW end date is confirmed via `AlertDialog` (never a bare RN
 * `Modal`, GOLDEN-FIX #1) because it can end the pattern immediately —
 * `schedulePatternCommandService.amend` flips status to `ended` when the
 * new `until` falls before "today" in the pattern's own timezone, and an
 * ended pattern cancels its own future shifts. Removing an end date and
 * skipping a week are both reversible via another amend, so neither one
 * confirms.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import type {
  AmendSchedulePatternInput,
  PauseRange,
} from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/src/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { FieldError } from '@/src/components/ui/field-error';
import { FieldLabel } from '@/src/components/ui/field-label';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, H4, Small } from '@/src/components/ui/typography';
import { TimeOffDateRangePicker } from '@/src/domains/timeOff/components/TimeOffDateRangePicker';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';
import {
  formatDate,
  isOnOrAfter,
  parseDate,
} from './AdjustSchedulePatternSheet.utils';

type SheetView = 'menu' | 'skip_week' | 'end_date';

export interface AdjustSchedulePatternSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** The accepted pattern's own start date — an end date before this is
   * refused, mirroring the command service's `INVALID_UNTIL` check. */
  dtstart: string;
  until: string | null;
  pauseRanges: readonly PauseRange[];
  onSubmit: (input: AmendSchedulePatternInput) => void;
  isSubmitting: boolean;
}

export function AdjustSchedulePatternSheet({
  visible,
  onDismiss,
  dtstart,
  until,
  pauseRanges,
  onSubmit,
  isSubmitting,
}: AdjustSchedulePatternSheetProps) {
  const { t } = useTranslation('schedule');
  const colors = useThemeColors();
  const [view, setView] = useState<SheetView>('menu');
  const [skipStart, setSkipStart] = useState(dtstart);
  const [skipEnd, setSkipEnd] = useState(dtstart);
  const [endDateValue, setEndDateValue] = useState(until ?? dtstart);
  const [endDateError, setEndDateError] = useState(false);
  const [endDateConfirmOpen, setEndDateConfirmOpen] = useState(false);

  // Re-seed every time the sheet opens — it stays mounted between openings
  // (the `MarkTimeOffPaidSheet` pattern), so without this a later open would
  // show the previous open's picked values.
  useEffect(() => {
    if (!visible) return;
    setView('menu');
    setSkipStart(dtstart);
    setSkipEnd(dtstart);
    setEndDateValue(until ?? dtstart);
    setEndDateError(false);
    setEndDateConfirmOpen(false);
  }, [visible, dtstart, until]);

  const backToMenu = () => setView('menu');

  const handleSkipWeekChange = (start: string, end: string) => {
    setSkipStart(start);
    setSkipEnd(end);
  };

  const submitSkipWeek = () => {
    onSubmit({
      pause_ranges: [...pauseRanges, { from: skipStart, to: skipEnd }],
    });
  };

  // The event param's real type lives in the native module's own
  // (untranspilable under bun:test) source — see TimeOffDateRangePicker's
  // header comment. Only `date` is needed here.
  const handleEndDateChange = (_event: unknown, date?: Date) => {
    if (!date) return;
    const next = formatDate(date);
    if (!isOnOrAfter(next, dtstart)) {
      setEndDateError(true);
      return;
    }
    setEndDateError(false);
    setEndDateValue(next);
  };

  const submitEndDate = () => {
    setEndDateConfirmOpen(false);
    onSubmit({ until: endDateValue });
  };

  const submitRemoveEndDate = () => {
    onSubmit({ until: null });
  };

  return (
    <BottomSheetBase
      sheetId="schedule-pattern-adjust"
      visible={visible}
      onDismiss={onDismiss}
      testID="schedule-adjust-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('pending.adjustSheetTitle')}</H4>
        <Body className="text-muted-foreground">
          {t('pending.adjustSheetDayTimeNote')}
        </Body>

        {view === 'menu' ? (
          <View testID="schedule-adjust-menu" className="gap-2">
            <Button
              testID="schedule-adjust-skip-week-option"
              variant="outline"
              onPress={() => setView('skip_week')}
            >
              <Text>{t('pending.adjustSkipWeekOption')}</Text>
            </Button>
            <Button
              testID="schedule-adjust-end-date-option"
              variant="outline"
              onPress={() => setView('end_date')}
            >
              <Text>{t('pending.adjustEndDateOption')}</Text>
            </Button>
          </View>
        ) : null}

        {view === 'skip_week' ? (
          <View testID="schedule-adjust-skip-week" className="gap-3">
            <Small className="text-muted-foreground">
              {t('pending.adjustSkipWeekBody')}
            </Small>
            <TimeOffDateRangePicker
              testID="schedule-adjust-skip-week-dates"
              start={skipStart}
              end={skipEnd}
              onChange={handleSkipWeekChange}
            />
            <View className="flex-row gap-2">
              <Button
                testID="schedule-adjust-skip-week-back"
                variant="ghost"
                onPress={backToMenu}
              >
                <Text>{t('pending.adjustBack')}</Text>
              </Button>
              <LoadingButton
                testID="schedule-adjust-skip-week-submit"
                label={t('pending.adjustSkipWeekSubmit')}
                isLoading={isSubmitting}
                onPress={submitSkipWeek}
              />
            </View>
          </View>
        ) : null}

        {view === 'end_date' ? (
          <View testID="schedule-adjust-end-date" className="gap-3">
            <Small className="text-muted-foreground">
              {t('pending.adjustEndDateBody')}
            </Small>
            <View className="gap-1">
              <FieldLabel>{t('pending.adjustEndDateLabel')}</FieldLabel>
              <View className="native:h-12 items-center justify-center rounded-lg border border-input bg-card px-2">
                <DateTimePicker
                  testID="schedule-adjust-end-date-picker"
                  value={parseDate(endDateValue)}
                  mode="date"
                  onChange={handleEndDateChange}
                  accentColor={colors.primary}
                  textColor={colors.foreground}
                  themeVariant="light"
                />
              </View>
              <FieldError testID="schedule-adjust-end-date-error">
                {endDateError ? t('pending.adjustEndDateError') : null}
              </FieldError>
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Button
                testID="schedule-adjust-end-date-back"
                variant="ghost"
                onPress={backToMenu}
              >
                <Text>{t('pending.adjustBack')}</Text>
              </Button>
              {until !== null ? (
                <Button
                  testID="schedule-adjust-end-date-remove"
                  variant="outline"
                  disabled={isSubmitting}
                  onPress={submitRemoveEndDate}
                >
                  <Text>{t('pending.adjustEndDateRemove')}</Text>
                </Button>
              ) : null}
              <AlertDialog
                open={endDateConfirmOpen}
                onOpenChange={setEndDateConfirmOpen}
              >
                <AlertDialogTrigger
                  testID="schedule-adjust-end-date-submit"
                  className={buttonVariants({})}
                  disabled={endDateError || isSubmitting}
                >
                  <Text className="text-primary-foreground font-medium">
                    {t('pending.adjustEndDateSubmit')}
                  </Text>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('pending.adjustEndDateConfirmTitle')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('pending.adjustEndDateConfirmBody')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      <Text>{t('pending.adjustEndDateConfirmCancel')}</Text>
                    </AlertDialogCancel>
                    <AlertDialogAction
                      testID="schedule-adjust-end-date-confirm"
                      disabled={isSubmitting}
                      onPress={submitEndDate}
                    >
                      <Text className="text-primary-foreground font-medium">
                        {t('pending.adjustEndDateConfirmConfirm')}
                      </Text>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </View>
          </View>
        ) : null}
      </View>
    </BottomSheetBase>
  );
}
