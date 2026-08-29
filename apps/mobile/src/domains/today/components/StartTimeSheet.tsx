/**
 * @module domains/today/components/StartTimeSheet
 *
 * Fix the start of a shift that is STILL RUNNING. She was due at 09:00,
 * started at 09:00, and only tapped Clock in at 09:20 — this is where she
 * corrects it, at the moment she notices, instead of carrying a wrong number
 * all day and remembering to fix it on Hours afterwards.
 *
 * Deliberately NOT a fourth `mode` on `ClockOutSheet`. That sheet renders two
 * times, a break picker, a custom-break input, a live total and a note; mid
 * shift, four of those describe things that have not happened yet, and the
 * live summary would need a synthesised finish to have anything to divide.
 * Reusing it would mean hiding two thirds of a 590-line component that
 * already forks eight behaviours on `mode`. This edits one value.
 *
 * There is no finish field and no total ON PURPOSE. The recomputed elapsed
 * time is already on screen — the running `Timer` directly above this sheet's
 * own trigger jumps the moment the mutation lands, which does the
 * confirmation work a summary block would duplicate.
 *
 * PREFILLED with the scheduled start when one is known. That was forbidden
 * before migration 113, because writing the schedule's claim over the app's
 * only observation destroyed the evidence — "we record what happened, not
 * what was planned". With the observation frozen in `observed_clock_in_at` it
 * cannot, so the prefill is safe and saves her typing the number she is
 * looking at. It is the same shape `overdueClockOutHint` already ships for
 * the forgotten clock-out, and the copy says so out loud.
 *
 * GOLDEN: `BottomSheetBase`, never a bare RN `Modal` (GOLDEN-FIXES #1). Its
 * `sheetId` is its own — sharing `ClockOutSheet`'s would make the two fight
 * over the store's mutual exclusion.
 *
 * Refusals render INLINE, never as a toast: the toast host is another RN
 * `<Modal>` and so is this sheet, so on iOS a toast fired over it is not
 * reliably visible (GOLDEN-FIXES #40).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Body, H4, Small } from '@/src/components/ui/typography';
import { describeTimeEntryWriteError } from '@/src/domains/timesheet/utils/timeEntryWriteError';
import { parseWallClockInput } from '@/src/domains/timesheet/utils/wallClockInput';
import { useUpdateTimeEntry } from '@/src/hooks/mutations/useUpdateTimeEntry';
import { localDateInZone } from '@/src/lib/localDate';
import { useIsOnline } from '@/src/lib/network';
import { utcIsoToWallClockHHMM, wallClockToUtcIso } from '@/src/lib/wallClock';

/** Mirrors the server's CLOCK_SKEW_TOLERANCE_MS so a few seconds of device
 * drift never flags an ordinary correction as a future start. */
const FUTURE_START_TOLERANCE_MS = 60_000;

interface StartTimeSheetProps {
  /** The running entry being corrected. */
  entryId: string;
  /** Its recorded start, ISO — the value the field falls back to. */
  clockInAt: string;
  /**
   * The matched shift's scheduled start, ISO, when one is known and differs
   * enough to be worth offering. Null prefills the recorded start instead.
   */
  scheduledStartAt: string | null;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21). */
  timeZone: string;
  onDismiss: () => void;
  /** Fired after the correction lands, so the caller can toast and close. */
  onSaved: () => void;
  /** Injectable "now" for deterministic tests. */
  nowMs?: number;
}

export function StartTimeSheet({
  entryId,
  clockInAt,
  scheduledStartAt,
  timeZone,
  onDismiss,
  onSaved,
  nowMs = Date.now(),
}: StartTimeSheetProps) {
  const { t } = useTranslation('today');
  const { t: tErrors } = useTranslation('errors');
  const isOnline = useIsOnline();
  const updateEntry = useUpdateTimeEntry();

  // The day the entry was written under, in the HOUSEHOLD's zone — every
  // conversion below is anchored on it, so a carer working away from home
  // never lands her correction on the device's date.
  const localDate = localDateInZone(timeZone, new Date(clockInAt));
  const prefill = utcIsoToWallClockHHMM(
    scheduledStartAt ?? clockInAt,
    timeZone
  );
  const [timeText, setTimeText] = useState(prefill);
  const [refusal, setRefusal] = useState<string | null>(null);

  const parsed = parseWallClockInput(timeText);
  const candidateIso = parsed
    ? wallClockToUtcIso(localDate, parsed, timeZone)
    : null;
  const candidateMs = candidateIso ? new Date(candidateIso).getTime() : null;

  const isInvalidFormat = parsed === null;
  const isFuture =
    candidateMs !== null && candidateMs > nowMs + FUTURE_START_TOLERANCE_MS;
  // A start typed onto a different local day would move `local_date`, which
  // is trigger-derived — the entry would jump days, and possibly weeks. The
  // server refuses that too; catching it here says which day, not "invalid".
  const isDifferentDay =
    candidateIso !== null &&
    localDateInZone(timeZone, new Date(candidateIso)) !== localDate;
  // The 16h span ceiling is NOT checked here. It cannot bite without also
  // crossing a day, which `isDifferentDay` already refuses with a sentence
  // that names the actual problem — and the server enforces it regardless.
  const blocked = isInvalidFormat || isFuture || isDifferentDay;

  const inlineError = isInvalidFormat
    ? t('invalidTime')
    : isFuture
      ? t('startTime.futureStartError')
      : isDifferentDay
        ? t('startTime.differentDayError')
        : refusal;

  const handleSubmit = () => {
    if (blocked || !candidateIso || updateEntry.isPending) return;
    setRefusal(null);
    updateEntry
      .mutateAsync({ entryId, clock_in_at: candidateIso })
      .then(onSaved)
      .catch((error: unknown) => {
        setRefusal(
          describeTimeEntryWriteError(error, tErrors, timeZone, isOnline)
            .message
        );
      });
  };

  return (
    <BottomSheetBase
      sheetId="today-start-time"
      visible
      onDismiss={onDismiss}
      testID="start-time-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('startTime.title')}</H4>
        <Body className="text-muted-foreground">
          {scheduledStartAt
            ? t('startTime.hint')
            : t('startTime.hintNoSchedule')}
        </Body>

        <View className="gap-1">
          <Small className="text-muted-foreground">{t('startLabel')}</Small>
          <Input
            testID="start-time-input"
            accessibilityLabel={t('startLabel')}
            value={timeText}
            onChangeText={setTimeText}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            placeholder="HH:MM"
          />
        </View>

        {inlineError ? (
          <Small testID="start-time-error" className="text-error-inline-text">
            {inlineError}
          </Small>
        ) : null}

        <LoadingButton
          testID="start-time-submit"
          label={t('startTime.save')}
          isLoading={updateEntry.isPending}
          disabled={blocked}
          onPress={handleSubmit}
        />
      </View>
    </BottomSheetBase>
  );
}
