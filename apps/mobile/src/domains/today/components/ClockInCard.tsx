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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { LiveDot } from '@/src/components/ui/live-dot';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Body, Caption, Small, Timer } from '@/src/components/ui/typography';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { formatEarningsSpanDate } from '@/src/domains/timesheet/utils/earningsFormat';
import { isOptimisticTimeEntry } from '@/src/hooks/mutations/timeEntryMutationUtils';
import { useClockIn } from '@/src/hooks/mutations/useClockIn';
import { useClockOut } from '@/src/hooks/mutations/useClockOut';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useShift } from '@/src/hooks/queries/useShift';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { updateOnShiftMatch } from '@/src/lib/liveActivity';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { showErrorToast } from '@/src/lib/toast';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
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
  /** Shown on the Live Activity's lock-screen banner only — a nanny with
   * several households must never have to guess which one she is on the
   * clock for. Optional so existing call sites keep working. */
  householdName?: string;
}

const ARRIVING_WINDOW_MS = 60 * 60 * 1000;

type OffClockShiftState =
  | { kind: 'scheduled'; start: string; end: string }
  | { kind: 'arriving'; start: string }
  | { kind: 'none' };

export function ClockInCard({
  householdId,
  timeZone,
  householdName,
}: ClockInCardProps) {
  const { t } = useTranslation('today');
  const { t: tErrors } = useTranslation('errors');
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const running = useRunningTimeEntry();
  const clockIn = useClockIn(timeZone, householdName);
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

  const today = useMemo(() => localDateInZone(timeZone), [timeZone]);
  const tomorrow = useMemo(() => addLocalDays(today, 1), [today]);
  const from = useMemo(
    () => wallClockToUtcIso(today, '00:00', timeZone),
    [today, timeZone]
  );
  const to = useMemo(
    () => wallClockToUtcIso(tomorrow, '00:00', timeZone),
    [tomorrow, timeZone]
  );
  const shifts = useShiftsRange(householdId, from, to);

  const offClockShift: OffClockShiftState = useMemo(() => {
    const todayShifts = (shifts.data ?? [])
      .filter(
        s =>
          s.local_date === today &&
          s.status !== 'cancelled' &&
          s.carer_id === currentUserId
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const next = todayShifts[0];
    if (!next) return { kind: 'none' };

    const startMs = new Date(next.starts_at).getTime();
    const now = Date.now();
    if (now < startMs && startMs - now <= ARRIVING_WINDOW_MS) {
      return {
        kind: 'arriving',
        start: formatClockTime(next.starts_at, timeZone),
      };
    }
    return {
      kind: 'scheduled',
      start: formatClockTime(next.starts_at, timeZone),
      end: formatClockTime(next.ends_at, timeZone),
    };
  }, [shifts.data, today, timeZone, currentUserId]);

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

  // The shift the clock-in matched has finished loading. The Live Activity
  // started without it (the clock-in response carries only a `shift_id`),
  // so this is where it gains its scheduled finish and progress bar. The
  // module ignores every later call — the finish is frozen once set.
  useEffect(() => {
    if (!clockInAt || !shift.data) return;
    void updateOnShiftMatch(shift.data, clockInAt, timeZone);
  }, [clockInAt, shift.data, timeZone]);

  // Arrived from the Live Activity's "Clock out" deep link. Routed through
  // the same handler as the on-screen button, so the forgotten-clock-out
  // pre-fill and every in-flight guard apply identically — the LA must
  // never be a second, thinner way to clock out (that was D20). The param
  // is cleared immediately so returning to this tab does not reopen it.
  const params = useLocalSearchParams<{ clockOut?: string }>();
  const router = useRouter();
  const clockOutRequested = params.clockOut === '1';
  // Nothing to open until the running-entry query has answered — a cold
  // start from the lock screen gets here first. Once it HAS answered, the
  // param is spent either way, including when the answer is "not running".
  const runningSettled = running.isSuccess || running.isError;
  const clockOutPressRef = useRef(handleClockOutPress);
  clockOutPressRef.current = handleClockOutPress;
  useEffect(() => {
    if (!clockOutRequested || !runningSettled) return;
    router.setParams({ clockOut: undefined });
    clockOutPressRef.current();
  }, [clockOutRequested, runningSettled, router]);

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
            <LiveDot testID="today-live-dot" />
            <Caption weight="semibold" className="text-highlight">
              {overdue ? t('stillOnTheClockTitle') : t('onTheClock')}
            </Caption>
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
          <Body weight="semibold">{t('notOnTheClock')}</Body>
          {offClockShift.kind === 'scheduled' ? (
            <Body
              testID="today-off-clock-scheduled"
              weight="semibold"
              className="text-foreground"
            >
              {t('nannyScheduledBody', {
                start: offClockShift.start,
                end: offClockShift.end,
              })}
            </Body>
          ) : offClockShift.kind === 'arriving' ? (
            <Body
              testID="today-off-clock-arriving"
              weight="semibold"
              className="text-foreground"
            >
              {t('nannyArrivingBody', { start: offClockShift.start })}
            </Body>
          ) : (
            <Small
              testID="today-off-clock-none"
              className="text-muted-foreground"
            >
              {t('nannyNoShiftBody')}
            </Small>
          )}
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
