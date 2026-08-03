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
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card, CardContent } from '@/src/components/ui/card';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, Small, Timer } from '@/src/components/ui/typography';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { isOptimisticTimeEntry } from '@/src/hooks/mutations/timeEntryMutationUtils';
import { useClockIn } from '@/src/hooks/mutations/useClockIn';
import { useClockOut } from '@/src/hooks/mutations/useClockOut';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useElapsedTimer } from '../hooks/useElapsedTimer';
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
  const running = useRunningTimeEntry();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const entry = running.data ?? null;
  const elapsed = useElapsedTimer(entry?.clock_in_at ?? null);

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
    setShowClockOutSheet(true);
  };

  const handleConfirmClockOut = ({
    breakMinutes,
    note,
  }: ClockOutSheetSubmitInput) => {
    if (
      !entry ||
      isOptimisticTimeEntry(entry) ||
      clockIn.isPending ||
      clockInInFlightRef.current ||
      clockOutInFlightRef.current
    ) {
      return;
    }
    clockOutInFlightRef.current = true;
    clockOut
      .mutateAsync({
        entryId: entry.id,
        ...(breakMinutes > 0 ? { break_minutes: breakMinutes } : {}),
        ...(note ? { note } : {}),
      })
      // Only close the sheet on success — useClockOut's onError already
      // shows a toast, and leaving the sheet open on failure means the
      // nanny's entered break/note aren't lost and retrying is one tap.
      .then(() => setShowClockOutSheet(false))
      // Same double-tap-escaping-as-unhandled-rejection rationale as
      // handleClockIn above.
      .catch(() => undefined)
      .finally(() => {
        clockOutInFlightRef.current = false;
      });
  };

  return (
    // `live` swaps the neutral plum shadow for the apricot one, on exactly the
    // predicate that drives the Today wash — so the card carries the signal and
    // the wash is its echo, rather than the room glowing around a neutral card.
    <Card testID="today-clock-card" live={Boolean(entry)}>
      <CardContent className="gap-4">
        {entry ? (
          <>
            <View className="flex-row items-center gap-2">
              <View
                testID="today-live-dot"
                className="h-[7px] w-[7px] rounded-full bg-highlight"
              />
              <Text className="text-[13px] font-semibold text-highlight">
                {t('onTheClock')}
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
            <LoadingButton
              testID="today-clock-out"
              variant="outline"
              label={t('clockOut')}
              isLoading={clockIn.isPending}
              disabled={clockOutBlocked}
              onPress={handleClockOutPress}
            />
            <ClockOutSheet
              visible={showClockOutSheet}
              onDismiss={() => setShowClockOutSheet(false)}
              onSubmit={handleConfirmClockOut}
              isSubmitting={clockOut.isPending}
              clockInAt={entry.clock_in_at}
              timeZone={timeZone}
            />
          </>
        ) : (
          <>
            <Body className="text-muted-foreground">{t('clockInHint')}</Body>
            <LoadingButton
              testID="today-clock-in"
              label={t('clockIn')}
              isLoading={clockIn.isPending || running.isLoading}
              onPress={handleClockIn}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
