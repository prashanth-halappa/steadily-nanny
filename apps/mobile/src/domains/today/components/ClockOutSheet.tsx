/**
 * @module domains/today/components/ClockOutSheet
 *
 * D20 — `ClockInCard`'s clock-out call site sent no input at all, so
 * `break_minutes` was permanently 0 and `note` permanently null while the
 * server's `computeWorkedMinutes` faithfully subtracted a break it never
 * received. Every day with a genuine unpaid break was recorded as more
 * hours worked than actually happened. This sheet is the fix: it lets the
 * nanny enter a break and an optional note before confirming clock-out.
 *
 * Stays fast for the common case — most days have no break, and a nanny
 * clocking out at the door shouldn't face a form. The break picker starts
 * on "No break" already selected, so confirming immediately (no interaction
 * at all) submits `{ breakMinutes: 0, note: '' }`; adding a break is one tap
 * on a quick-pick chip, or a typed custom value for anything else.
 *
 * Daylight audit P0-2 — the sheet used to ask for a break without ever
 * showing the clock-in time, the clock-out time, or the resulting total, so
 * tapping "30 min" silently changed the recorded day with no on-screen
 * acknowledgement. The summary block below the break picker fixes that: it
 * recomputes live off `breakMinutes` (and `nowMs`, injectable for tests)
 * with `computeWorkedMinutesFromInstants` — the SAME rule the server uses
 * in `computeWorkedMinutes` (see that function's own comment for why the
 * two formulas are equivalent) — so the number shown is the number that
 * will be recorded. A break longer than the elapsed time clamps the preview
 * to 0m, same as the server: it must read as "no hours", not as an error
 * the nanny has to resolve before she can leave.
 *
 * Daylight audit #7 / P0-2 (second half) — the sheet now also owns the two
 * cases where "now" is the wrong finish. A FORGOTTEN clock-out opens with
 * the scheduled finish pre-filled and says so (`showOverdueHint`), so a
 * carer who left at 17:00 and remembers at 08:00 doesn't bank fourteen idle
 * hours. And `mode="edit"` reopens the same sheet against an
 * already-clocked-out entry from the Hours screen, which is the correction
 * path that did not exist at all. One component for all three because the
 * live summary — the thing that shows the figure before it is written — must
 * not exist in two versions that can disagree.
 *
 * GOLDEN: uses `BottomSheetBase`, never a bare RN Modal directly
 * (GOLDEN-FIXES #1 — iOS modal-freeze).
 */
import { MAX_SESSION_SPAN_MS } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Small } from '@/src/components/ui/typography';
// Direct file imports, NOT the domain barrel (`@/src/domains/timesheet`) —
// that barrel re-exports `HoursScreen`, which pulls in `LoadingIndicator`'s
// `require('@/assets/splash.png')` and breaks bundling under bun:test (see
// HoursScreen.test.tsx's header comment). These utils are pure and have no
// such cost, so importing them directly avoids forcing every test that
// renders this sheet to mock loading-indicator for an unrelated import.
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { computeWorkedMinutesFromInstants } from '@/src/domains/timesheet/utils/entryMinutes';
import { parseWallClockInput } from '@/src/domains/timesheet/utils/wallClockInput';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { localDateInZone } from '@/src/lib/localDate';
import {
  shiftInstantsFromWallClock,
  utcIsoToWallClockHHMM,
} from '@/src/lib/wallClock';

const QUICK_BREAK_MINUTES = [0, 15, 30, 45, 60] as const;

// Mirrors the server's CLOCK_SKEW_TOLERANCE_MS
// (apps/api/src/domains/timesheet/services/timesheetCommandService.ts) so
// the client and the eventual 400 agree on what counts as "future" — a few
// seconds of clock drift must not flag an ordinary clock-out.
const FUTURE_FINISH_TOLERANCE_MS = 60_000;

export interface ClockOutSheetSubmitInput {
  breakMinutes: number;
  note: string;
  /**
   * The finish the carer confirmed, as an ISO instant — present only when
   * she typed one, or when the sheet pre-filled a scheduled finish for a
   * forgotten clock-out. Absent means "whatever the server's clock says",
   * which is the ordinary case and keeps second-level precision that a
   * HH:MM field would round away.
   */
  clockOutAt?: string;
  /** The start, ISO — edit mode only, and only when actually changed. */
  clockInAt?: string;
}

interface ClockOutSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: ClockOutSheetSubmitInput) => void;
  isSubmitting: boolean;
  /** ISO clock-in instant for the live summary preview. `null` only for the
   * data-anomaly case of a running entry with no recorded clock-in — the
   * summary is simply omitted then, same defensive pattern as `ClockInCard`'s
   * own `entry.clock_in_at ?` guard. */
  clockInAt: string | null;
  /** Household IANA zone — every time label here is zone-aware, never the
   * device's (GOLDEN-FIXES #21 bug class; see
   * domains/timesheet/utils/week.ts's header). */
  timeZone: string;
  /** "Now", for the live "Out"/total preview. Defaults to the real current
   * time; tests inject a fixed value for determinism. Re-evaluated on every
   * render, so it moves as the break selection changes. */
  nowMs?: number;
  /**
   * The finish to pre-fill, ISO. Defaults to `nowMs` — the ordinary case.
   * A forgotten clock-out passes the scheduled finish instead (see
   * `utils/clockOutReminder.resolveDefaultClockOutAt`): "now" is the one
   * answer certainly wrong when the carer left hours ago.
   */
  defaultClockOutAt?: string;
  /**
   * `'edit'` corrects an already-clocked-out entry (Daylight UX P0-2): the
   * START becomes editable too and the confirm button says "Save" rather
   * than "Clock out". Same sheet on purpose — the live summary that makes
   * the recorded figure visible before it's written is the whole point, and
   * it should not exist in two versions that can disagree.
   */
  mode?: 'clockOut' | 'edit';
  /** Edit mode: the entry's current break/note, so the sheet opens on the
   * record as it stands rather than on blanks. */
  initialBreakMinutes?: number;
  initialNote?: string;
  /** Say out loud that the pre-filled finish is a guess from the schedule,
   * not something the carer did. Set for the forgotten-clock-out path. */
  showOverdueHint?: boolean;
  /**
   * A refusal the server returned for the LAST submit, already localized by
   * the caller. Rendered inline, alongside the sheet's own pre-submit
   * errors, because a toast fired while a `BottomSheetBase` is presented is
   * not reliably visible on iOS — the sheet is itself an RN `<Modal>` and so
   * is the toast host (GOLDEN-FIXES #1, same modal-over-modal family). A
   * carer whose correction is refused saw nothing at all before this.
   */
  submitError?: string | null;
  /**
   * Optional action rendered under `submitError` — e.g. "Open that entry"
   * when the refusal names a conflicting entry the caller can jump to.
   */
  submitErrorAction?: { label: string; onPress: () => void } | null;
  /**
   * Edit mode only: opens the caller's void confirmation. Absent means the
   * entry cannot be voided (a running entry is voided from Today, and an
   * approved week is not the carer's to reopen), so the affordance is simply
   * not offered rather than shown-and-refused.
   */
  onVoidPress?: (() => void) | null;
  /** Label for the void trigger — the caller owns `hours` namespace copy. */
  voidLabel?: string;
}

/** Parses a break-minutes text field to a non-negative integer, defaulting
 * to 0 for anything invalid rather than letting NaN reach the server. */
function parseBreakMinutes(text: string): number {
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function ClockOutSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  clockInAt,
  timeZone,
  nowMs = Date.now(),
  defaultClockOutAt,
  mode = 'clockOut',
  initialBreakMinutes = 0,
  initialNote = '',
  showOverdueHint = false,
  submitError = null,
  submitErrorAction = null,
  onVoidPress = null,
  voidLabel,
}: ClockOutSheetProps) {
  const { t } = useTranslation('today');
  const [breakMinutes, setBreakMinutes] = useState(initialBreakMinutes);
  const [breakMinutesText, setBreakMinutesText] = useState(
    String(initialBreakMinutes)
  );
  const [note, setNote] = useState(initialNote);
  // `null` means "untouched" for the finish, which is what keeps an ordinary
  // clock-out on the server's own second-precise clock instead of rounding
  // it to the typed minute. The start has no such case: it always shows the
  // recorded value, and only edit mode lets it be changed.
  const [outTimeText, setOutTimeText] = useState<string | null>(null);
  const [inTimeText, setInTimeText] = useState<string | null>(null);

  // Re-seed whenever the sheet opens: it stays mounted between openings, so
  // without this a correction would show the previous entry's values.
  useEffect(() => {
    if (!visible) return;
    setBreakMinutes(initialBreakMinutes);
    setBreakMinutesText(String(initialBreakMinutes));
    setNote(initialNote);
    // `clockOut` mode ARMS the pre-filled finish: a forgotten clock-out must
    // actually SEND the scheduled finish, or the server's own clock banks the
    // idle hours (see `ClockOutSheetSubmitInput.clockOutAt`). `edit` mode must
    // not: the recorded finish is already correct, and re-sending it rebuilt
    // from HH:MM rounded the recorded seconds away on every break-only
    // correction. `shownOutTime` still displays it — untouched just means
    // untouched, exactly as it already does for the start.
    setOutTimeText(
      mode !== 'edit' && defaultClockOutAt
        ? utcIsoToWallClockHHMM(defaultClockOutAt, timeZone)
        : null
    );
    setInTimeText(null);
  }, [
    visible,
    initialBreakMinutes,
    initialNote,
    defaultClockOutAt,
    timeZone,
    mode,
  ]);

  const recordedInTime = clockInAt
    ? utcIsoToWallClockHHMM(clockInAt, timeZone)
    : '';
  const shownInTime = inTimeText ?? recordedInTime;
  const shownOutTime =
    outTimeText ??
    utcIsoToWallClockHHMM(
      defaultClockOutAt ?? new Date(nowMs).toISOString(),
      timeZone
    );

  const parsedInTime = parseWallClockInput(shownInTime);
  const parsedOutTime = parseWallClockInput(shownOutTime);
  const timesAreValid = Boolean(parsedInTime && parsedOutTime);

  /**
   * The two typed wall clocks resolved back to real instants in the
   * HOUSEHOLD's zone (never the device's — GOLDEN-FIXES #21).
   * `shiftInstantsFromWallClock` is reused rather than reimplemented because
   * it already rolls a finish at or before the start onto the next day,
   * which is exactly an overnight shift — the case a carer is most likely
   * to have forgotten to clock out of.
   *
   * EQUALITY is the one finish that isn't overnight: the same minute in and
   * out is a zero-length session, and rolling it forward previewed a 24-hour
   * shift the server would refuse anyway (16h cap). Collapsed here rather
   * than in `shiftInstantsFromWallClock`, whose other callers are shift
   * editing, where an end equal to the start is a different question.
   */
  const rolledInstants =
    clockInAt && parsedInTime && parsedOutTime
      ? shiftInstantsFromWallClock(
          localDateInZone(timeZone, new Date(clockInAt)),
          parsedInTime,
          parsedOutTime,
          timeZone
        )
      : null;
  const isZeroLength = Boolean(
    parsedInTime && parsedOutTime && parsedInTime === parsedOutTime
  );
  // Same "finish at or before start" comparison `shiftInstantsFromWallClock`
  // uses to decide whether to roll onto the next day, minus the equal case
  // (that's `isZeroLength`, handled separately above). A rolled finish is a
  // legitimate overnight shift even though the resolved instant can land
  // after `nowMs` — only a NON-rolled finish that's after now is wrong.
  const isOvernightRoll = Boolean(
    parsedInTime && parsedOutTime && parsedOutTime < parsedInTime
  );
  const instants =
    rolledInstants && isZeroLength
      ? { ...rolledInstants, ends_at: rolledInstants.starts_at }
      : rolledInstants;

  /**
   * The span the server will actually measure, and the ceiling it measures
   * it against. `shiftInstantsFromWallClock` rolls a finish at or before the
   * start onto the NEXT day, so the rolled span is `24h - (start - finish)`
   * — under the 16h cap only when the finish is typed at least 8 hours
   * earlier than the start. Every value inside that 8-hour window was a
   * guaranteed 400 the carer could neither predict nor see: she typed `527`
   * meaning 5:27 pm against an 06:53 start and got a 22h 34m overnight
   * shift. Caught here, before the request, with the number named.
   */
  const spanMs = instants
    ? new Date(instants.ends_at).getTime() -
      new Date(instants.starts_at).getTime()
    : 0;
  const isTooLong = spanMs > MAX_SESSION_SPAN_MS;

  /**
   * The day a rolled finish actually lands on. An overnight correction is
   * legitimate and must stay possible, but it cannot be INVISIBLE — that is
   * what let a mistyped finish read as an ordinary same-day one.
   */
  const overnightFinishDate =
    instants && isOvernightRoll && !isTooLong
      ? formatDisplayDate(localDateInZone(timeZone, new Date(instants.ends_at)))
      : null;

  const effectiveClockInAt = instants?.starts_at ?? clockInAt;
  const effectiveClockOutMs = instants
    ? new Date(instants.ends_at).getTime()
    : nowMs;

  const isFutureFinish = Boolean(
    instants &&
      !isZeroLength &&
      !isOvernightRoll &&
      effectiveClockOutMs > nowMs + FUTURE_FINISH_TOLERANCE_MS
  );

  const workedMinutes = effectiveClockInAt
    ? computeWorkedMinutesFromInstants(
        effectiveClockInAt,
        effectiveClockOutMs,
        breakMinutes
      )
    : 0;

  const selectQuickBreak = (minutes: number) => {
    setBreakMinutes(minutes);
    setBreakMinutesText(String(minutes));
  };

  const handleBreakMinutesChange = (text: string) => {
    setBreakMinutesText(text);
    setBreakMinutes(parseBreakMinutes(text));
  };

  const handleSubmit = () => {
    if (!timesAreValid || isZeroLength || isTooLong || isFutureFinish) return;
    onSubmit({
      breakMinutes,
      note: note.trim(),
      // Only sent when the carer set a finish — see the field's own comment.
      ...(outTimeText !== null && instants
        ? { clockOutAt: instants.ends_at }
        : {}),
      ...(mode === 'edit' && inTimeText !== null && instants
        ? { clockInAt: instants.starts_at }
        : {}),
    });
  };

  return (
    <BottomSheetBase
      sheetId="today-clock-out"
      visible={visible}
      onDismiss={onDismiss}
      testID="clockout-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>
          {mode === 'edit' ? t('editEntryTitle') : t('clockOutSheetTitle')}
        </H4>
        <Body className="text-muted-foreground">
          {mode === 'edit' ? t('editEntryHint') : t('clockOutSheetHint')}
        </Body>

        {showOverdueHint ? (
          <Body testID="clockout-overdue-hint" className="text-warning-ink">
            {t('overdueClockOutHint')}
          </Body>
        ) : null}

        {clockInAt ? (
          <View className="flex-row gap-3" testID="clockout-times">
            <View className="flex-1 gap-1">
              <Small className="text-muted-foreground">{t('startLabel')}</Small>
              <Input
                testID="clockout-start-time"
                accessibilityLabel={t('startLabel')}
                value={shownInTime}
                onChangeText={setInTimeText}
                editable={mode === 'edit'}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                placeholder="HH:MM"
              />
            </View>
            <View className="flex-1 gap-1">
              <Small className="text-muted-foreground">
                {t('finishLabel')}
              </Small>
              <Input
                testID="clockout-finish-time"
                accessibilityLabel={t('finishLabel')}
                value={shownOutTime}
                onChangeText={setOutTimeText}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                placeholder="HH:MM"
              />
              {overnightFinishDate ? (
                <Small
                  testID="clockout-overnight-hint"
                  className="text-muted-foreground"
                >
                  {t('overnightFinishHint', { date: overnightFinishDate })}
                </Small>
              ) : null}
            </View>
          </View>
        ) : null}

        {clockInAt && !timesAreValid ? (
          <Small
            testID="clockout-time-error"
            className="text-error-inline-text"
          >
            {t('invalidTime')}
          </Small>
        ) : null}

        {clockInAt && timesAreValid && isZeroLength ? (
          <Small
            testID="clockout-zero-length-error"
            className="text-error-inline-text"
          >
            {/* A running entry at zero elapsed is not a typo to correct — she
                has just clocked in by mistake, and "type a later finish" is
                advice she cannot act on. Point at the discard instead. In
                edit mode the original wording is right. */}
            {mode === 'edit'
              ? t('zeroLengthFinishError')
              : t('zeroLengthRunningError')}
          </Small>
        ) : null}

        {clockInAt && timesAreValid && !isZeroLength && isTooLong ? (
          <Small
            testID="clockout-too-long-error"
            className="text-error-inline-text"
          >
            {t('tooLongFinishError', {
              total: formatDuration(Math.round(spanMs / 60_000)),
              maxHours: MAX_SESSION_SPAN_MS / 3_600_000,
            })}
          </Small>
        ) : null}

        {clockInAt &&
        timesAreValid &&
        !isZeroLength &&
        !isTooLong &&
        isFutureFinish ? (
          <Small
            testID="clockout-future-finish-error"
            className="text-error-inline-text"
          >
            {t('futureFinishError')}
          </Small>
        ) : null}

        {submitError ? (
          <View className="gap-1">
            <Small
              testID="clockout-submit-error"
              className="text-error-inline-text"
            >
              {submitError}
            </Small>
            {submitErrorAction ? (
              <Button
                testID="clockout-submit-error-action"
                variant="outline"
                size="default"
                onPress={submitErrorAction.onPress}
              >
                <Text>{submitErrorAction.label}</Text>
              </Button>
            ) : null}
          </View>
        ) : null}

        <View className="gap-2">
          <Small className="text-muted-foreground">{t('breakLabel')}</Small>
          <View
            className="flex-row flex-wrap gap-2"
            testID="clockout-break-options"
          >
            {QUICK_BREAK_MINUTES.map(minutes => (
              <Button
                key={minutes}
                testID={`clockout-break-${minutes}`}
                variant={breakMinutes === minutes ? 'secondary' : 'outline'}
                // Daylight audit #39 — the small button size is 36px tall,
                // under the 44pt minimum touch target, and these are tapped
                // one-handed at the door. The default size (native:h-12)
                // clears it.
                size="default"
                onPress={() => selectQuickBreak(minutes)}
              >
                <Text>
                  {minutes === 0
                    ? t('noBreak')
                    : t('breakMinutesOption', { minutes })}
                </Text>
              </Button>
            ))}
          </View>
          <View className="gap-1">
            <Small className="text-muted-foreground">
              {t('customBreakLabel')}
            </Small>
            <View className="flex-row items-center gap-2">
              <Input
                testID="clockout-break-custom"
                accessibilityLabel={t('customBreakLabel')}
                value={breakMinutesText}
                onChangeText={handleBreakMinutesChange}
                keyboardType="number-pad"
                className="w-20"
              />
              <Small className="text-muted-foreground">
                {t('minutesUnit')}
              </Small>
            </View>
          </View>
        </View>

        {clockInAt ? (
          <View
            testID="clockout-summary"
            className="flex-row flex-wrap items-baseline gap-x-1"
          >
            <Small
              testID="clockout-summary-prefix"
              className="text-muted-foreground"
              tabular
            >
              {t('clockOutSummaryPrefix', {
                in: formatClockTime(effectiveClockInAt ?? clockInAt, timeZone),
                out: formatClockTime(
                  new Date(effectiveClockOutMs).toISOString(),
                  timeZone
                ),
                breakMinutes,
              })}
            </Small>
            <Body testID="clockout-summary-total" weight="semibold" tabular>
              {formatDuration(workedMinutes)}
            </Body>
          </View>
        ) : null}

        <Textarea
          testID="clockout-note"
          accessibilityLabel={t('noteLabel')}
          value={note}
          onChangeText={setNote}
          placeholder={t('notePlaceholder')}
        />

        <LoadingButton
          testID="clockout-confirm"
          label={mode === 'edit' ? t('saveCorrection') : t('clockOut')}
          isLoading={isSubmitting}
          disabled={
            !timesAreValid || isZeroLength || isTooLong || isFutureFinish
          }
          onPress={handleSubmit}
        />

        {/* Destructive, so it sits BELOW the primary action and reads as a
            ghost — a carer reaching for "Save" must not land on "Void" by
            muscle memory. The confirm step lives in the caller's dialog. */}
        {mode === 'edit' && onVoidPress ? (
          <Button
            testID="clockout-void"
            variant="ghost"
            size="default"
            onPress={onVoidPress}
          >
            <Text className="text-error-inline-text">{voidLabel}</Text>
          </Button>
        ) : null}
      </View>
    </BottomSheetBase>
  );
}
