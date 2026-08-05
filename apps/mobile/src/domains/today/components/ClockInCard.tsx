/**
 * @module domains/today/components/ClockInCard
 *
 * The nanny's clock-in card on the Today screen. Location is reassurance,
 * never a gate — this never blocks clock-in on anything (no permission
 * prompt, no schedule-window check: "Starting early? Clock in whenever — we
 * record what happened, not what was planned"). Once running, shows a live
 * elapsed timer via `useElapsedTimer` (its own file, own cleanup tests).
 *
 * No NativeWind `className` on an `Animated.View` here on purpose — the
 * timer is plain text driven by React state, not Reanimated, so the
 * GOLDEN-FIXES #2 gotcha simply doesn't apply; no Animated.View is used.
 *
 * D20: "Clock out" no longer clocks out directly — it opens `ClockOutSheet`
 * so a genuine unpaid break can be recorded (`break_minutes` was previously
 * always sent as nothing, so every break was recorded as worked time). The
 * sheet defaults to "no break" already selected, so confirming it is still
 * one tap for the common case.
 *
 * Daylight audit #7: nothing used to handle a FORGOTTEN clock-out — the
 * timer would read `37h 12m` the next morning and the server would record
 * it. Past the entry's own threshold (`utils/clockOutReminder`, the
 * scheduled finish plus grace where a shift was matched) the card stops
 * reporting and starts asking, and the sheet opens pre-filled with the
 * scheduled finish instead of "now". `useClockOutReminder` is the other
 * half, for the carer whose phone is in her pocket.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, Small, Timer } from '@/src/components/ui/typography';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { formatEarningsSpanDate } from '@/src/domains/timesheet/utils/earningsFormat';
import { isOptimisticTimeEntry } from '@/src/hooks/mutations/timeEntryMutationUtils';
import { useClockIn } from '@/src/hooks/mutations/useClockIn';
import { useClockOut } from '@/src/hooks/mutations/useClockOut';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useShift } from '@/src/hooks/queries/useShift';
import { localDateInZone } from '@/src/lib/localDate';
import { showErrorToast } from '@/src/lib/toast';
import { useClockOutReminder } from '../hooks/useClockOutReminder';
import { useElapsedTimer } from '../hooks/useElapsedTimer';
import {
  isOverdue as isEntryOverdue,
  resolveDefaultClockOutAt,
} from '../utils/clockOutReminder';
import {
  formatTimeEntryOverlapMessage,
  getOverlappingEntry,
} from '../utils/timeEntryOverlapError';
import { ClockOutSheet, type ClockOutSheetSubmitInput } from './ClockOutSheet';

interface ClockInCardProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21 bug class;
   * see domains/timesheet/utils/week.ts's header). Drives every clock time
   * this card and its `ClockOutSheet` render. */
  timeZone: string;
}

export function ClockInCard({ householdId, timeZone }: ClockInCardProps) {
  const { t } = useTranslation('today');
  const { t: tErrors } = useTranslation('errors');
  const running = useRunningTimeEntry();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const entry = running.data ?? null;
  const elapsed = useElapsedTimer(entry?.clock_in_at ?? null);

  // The shift clock-in already auto-matched (within 2h — see the API's
  // `matchConfirmedShift`). Its scheduled finish is what makes "still on the
  // clock?" land at a time that means something, rather than at a flat cap.
  // Disabled by `useShift` itself when there is no `shift_id`.
  const shift = useShift(entry?.shift_id);
  const shiftEndsAt = shift.data?.ends_at ?? null;
  const clockInAt = entry?.clock_in_at ?? null;

  useClockOutReminder(clockInAt, shiftEndsAt);

  // Re-derived on every tick of `useElapsedTimer`, so the card crosses into
  // its overdue state while the carer is looking at it — no extra timer.
  const nowMs = Date.now();
  const overdue = Boolean(
    clockInAt && isEntryOverdue(clockInAt, shiftEndsAt, nowMs)
  );

  // D7 (double-tap clock-in): `clockIn.isPending` only flips once React
  // commits a re-render, but a fast double-tap can fire the second press
  // handler before that render ever happens — so the LoadingButton's
  // `disabled` prop alone doesn't close the race. These refs are read/set
  // synchronously inside the handler itself, so the second tap is dropped
  // at the source regardless of render timing. The 409 that DOES get through
  // (e.g. from a second device) is still handled truthfully — see
  // useClockIn's onError, which refetches on ALREADY_CLOCKED_IN.
  const clockInInFlightRef = useRef(false);
  const clockOutInFlightRef = useRef(false);
  const [showClockOutSheet, setShowClockOutSheet] = useState(false);
  // Frozen when the sheet opens so the optimistic clear (and a 409 overlap
  // invalidate) can null the running cache without remounting the sheet or
  // reseeding its draft from shifting props.
  const sheetClockInAtRef = useRef<string | null>(null);
  const sheetEntryIdRef = useRef<string | null>(null);
  const sheetDefaultClockOutAtRef = useRef<string | undefined>(undefined);
  const sheetShowOverdueHintRef = useRef(false);

  const clockOutBlocked =
    !entry ||
    isOptimisticTimeEntry(entry) ||
    clockIn.isPending ||
    clockInInFlightRef.current;

  const handleClockIn = () => {
    if (clockInInFlightRef.current) return;
    clockInInFlightRef.current = true;
    clockIn
      .mutateAsync({ household_id: householdId })
      // useClockIn's onError already surfaces this failure (toast, plus a
      // refetch on ALREADY_CLOCKED_IN) — caught here only so a losing
      // double-tap request never escapes as an unhandled promise rejection.
      .catch(() => undefined)
      .finally(() => {
        clockInInFlightRef.current = false;
      });
  };

  // D20: only opens the sheet — no network call yet. The actual clock-out
  // (with whatever break/note were entered) happens in
  // `handleConfirmClockOut` below, from the sheet's own confirm button.
  const handleClockOutPress = () => {
    if (
      !entry ||
      isOptimisticTimeEntry(entry) ||
      clockIn.isPending ||
      clockInInFlightRef.current
    ) {
      return;
    }
    sheetClockInAtRef.current = entry.clock_in_at;
    sheetEntryIdRef.current = entry.id;
    sheetDefaultClockOutAtRef.current =
      overdue && clockInAt
        ? resolveDefaultClockOutAt(clockInAt, shiftEndsAt, nowMs)
        : undefined;
    sheetShowOverdueHintRef.current = overdue && Boolean(shiftEndsAt);
    setShowClockOutSheet(true);
  };

  const handleConfirmClockOut = ({
    breakMinutes,
    note,
    clockOutAt,
  }: ClockOutSheetSubmitInput) => {
    // Prefer the live entry; fall back to the ids stashed when the sheet
    // opened so a retry still works while the optimistic clear has left
    // `running` briefly null (overlap 409 path invalidates rather than
    // rolling back immediately).
    const entryId =
      entry && !isOptimisticTimeEntry(entry)
        ? entry.id
        : sheetEntryIdRef.current;
    if (
      !entryId ||
      clockIn.isPending ||
      clockInInFlightRef.current ||
      clockOutInFlightRef.current ||
      (entry !== null && isOptimisticTimeEntry(entry))
    ) {
      return;
    }
    clockOutInFlightRef.current = true;
    clockOut
      .mutateAsync({
        entryId,
        ...(breakMinutes > 0 ? { break_minutes: breakMinutes } : {}),
        ...(note ? { note } : {}),
        // Absent unless the carer set a finish — the server's own clock is
        // the right answer for an ordinary clock-out at the door.
        ...(clockOutAt ? { clock_out_at: clockOutAt } : {}),
      })
      // Only close the sheet on success — useClockOut's onError already
      // shows a toast for generic failures, and leaving the sheet open on
      // failure means the nanny's entered break/note aren't lost and
      // retrying is one tap.
      .then(() => setShowClockOutSheet(false))
      .catch((error: unknown) => {
        // Overlap is more than a generic conflict: the entry stays running
        // and she can't clock in again. Name the conflicting entry by day
        // and time range (household zone — GOLDEN-FIXES #21) so she can
        // find it on Hours. useClockOut still toasts the generic conflict
        // copy; this is the actionable one.
        const overlapping = getOverlappingEntry(error);
        if (overlapping) {
          const day = formatEarningsSpanDate(
            localDateInZone(timeZone, new Date(overlapping.clockInAt))
          );
          const range = `${formatClockTime(overlapping.clockInAt, timeZone)}–${formatClockTime(overlapping.clockOutAt, timeZone)}`;
          showErrorToast(formatTimeEntryOverlapMessage(tErrors, day, range));
        }
      })
      .finally(() => {
        clockOutInFlightRef.current = false;
      });
  };

  const sheetClockInAt = sheetClockInAtRef.current;
  const sheetDefaultClockOutAt = sheetDefaultClockOutAtRef.current;
  const sheetShowOverdueHint = sheetShowOverdueHintRef.current;

  return (
    <Card
      testID="today-clock-card"
      live={Boolean(entry)}
      className="gap-4 p-5.5"
    >
      {entry ? (
        <>
          <View className="flex-row items-center gap-2">
            <View
              testID="today-live-dot"
              className="h-[10px] w-[10px] rounded-full bg-highlight"
            />
            <Text className="text-[13px] font-semibold text-highlight">
              {overdue ? t('stillOnTheClockTitle') : t('onTheClock')}
            </Text>
          </View>
          <Timer testID="today-live-timer">{elapsed}</Timer>
          {entry.clock_in_at ? (
            <Small className="text-muted-foreground">
              {t('since', {
                time: formatClockTime(entry.clock_in_at, timeZone),
              })}
            </Small>
          ) : null}
          {overdue ? (
            <Body testID="today-overdue-hint" className="text-warning">
              {t('stillOnTheClockBody')}
            </Body>
          ) : null}
          <LoadingButton
            testID="today-clock-out"
            // The overdue state is the one moment this is the only thing
            // worth doing on the screen, so it stops being a quiet outline.
            variant={overdue ? 'default' : 'outline'}
            label={overdue ? t('clockOutNow') : t('clockOut')}
            isLoading={clockIn.isPending}
            disabled={clockOutBlocked}
            onPress={handleClockOutPress}
          />
        </>
      ) : (
        <>
          <Body className="font-semibold">{t('notOnTheClock')}</Body>
          <Body className="text-muted-foreground">{t('clockInHint')}</Body>
          <LoadingButton
            testID="today-clock-in"
            label={t('clockIn')}
            isLoading={clockIn.isPending || running.isLoading}
            onPress={handleClockIn}
          />
        </>
      )}
      {/*
        Mounted while the sheet is open (including across useClockOut's
        optimistic clear) so a 409 TIME_ENTRY_OVERLAPS — which invalidates
        rather than rolling back — cannot wipe the typed break/note. Unmounted
        once closed so success still clears `clockout-sheet` from the tree.
      */}
      {showClockOutSheet ? (
        <ClockOutSheet
          visible={showClockOutSheet}
          onDismiss={() => setShowClockOutSheet(false)}
          onSubmit={handleConfirmClockOut}
          isSubmitting={clockOut.isPending}
          clockInAt={sheetClockInAt}
          timeZone={timeZone}
          // Only pre-filled once overdue. Left undefined for an ordinary
          // clock-out on purpose: the sheet then sends no finish at all
          // and the server's own clock records it, keeping the
          // second-level precision a typed HH:MM would round away.
          defaultClockOutAt={sheetDefaultClockOutAt}
          showOverdueHint={sheetShowOverdueHint}
        />
      ) : null}
    </Card>
  );
}
