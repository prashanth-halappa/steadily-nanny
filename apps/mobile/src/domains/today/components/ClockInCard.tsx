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
 */
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/src/components/ui/card';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Body, H2, Small } from '@/src/components/ui/typography';
import { formatClockTime } from '@/src/domains/timesheet';
import { useClockIn } from '@/src/hooks/mutations/useClockIn';
import { useClockOut } from '@/src/hooks/mutations/useClockOut';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { useElapsedTimer } from '../hooks/useElapsedTimer';

interface ClockInCardProps {
  householdId: string;
}

export function ClockInCard({ householdId }: ClockInCardProps) {
  const { t } = useTranslation('today');
  const running = useRunningTimeEntry();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const entry = running.data ?? null;
  const elapsed = useElapsedTimer(entry?.clock_in_at ?? null);

  const handleClockIn = () => {
    void clockIn.mutateAsync({ household_id: householdId });
  };

  const handleClockOut = () => {
    if (!entry) return;
    void clockOut.mutateAsync({ entryId: entry.id });
  };

  return (
    <Card testID="today-clock-card">
      <CardContent className="gap-4 p-6">
        {entry ? (
          <>
            <Small className="text-muted-foreground">{t('onTheClock')}</Small>
            <H2 testID="today-live-timer">{elapsed}</H2>
            {entry.clock_in_at ? (
              <Small className="text-muted-foreground">
                {t('since', { time: formatClockTime(entry.clock_in_at) })}
              </Small>
            ) : null}
            <LoadingButton
              testID="today-clock-out"
              variant="outline"
              label={t('clockOut')}
              isLoading={clockOut.isPending}
              onPress={handleClockOut}
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
