/**
 * @module domains/today/components/NannyLiveStatusCard
 *
 * Parent-only: when any household time entry is still `running`, show a
 * live status card on Today so the parent can see the nanny is on the clock
 * without opening Hours. Reuses the week list API (no new endpoint).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { Body } from '@/src/components/ui/typography';
// Direct file imports, NOT the domain barrel (`@/src/domains/timesheet`) —
// that barrel re-exports `HoursScreen`, which pulls in `LoadingIndicator`'s
// `require('@/assets/splash.png')` and breaks bundling under bun:test (see
// HoursScreen.test.tsx's header comment). These two utils are pure and have
// no such cost, so importing them directly keeps this component's tests
// (and anything else that renders it) from having to mock loading-indicator
// just to satisfy an unrelated import.
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';

interface NannyLiveStatusCardProps {
  householdId: string;
  timeZone: string;
}

export function NannyLiveStatusCard({
  householdId,
  timeZone,
}: NannyLiveStatusCardProps) {
  const { t } = useTranslation('today');
  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone),
    [timeZone]
  );
  const entries = useWeekTimeEntries(householdId, weekStart);
  const running = (entries.data ?? []).find(e => e.status === 'running');

  if (!running?.clock_in_at) return null;

  return (
    <Card testID="today-nanny-live-status" live className="gap-1 p-5.5">
      {/* Same apricot signal the nanny sees on their own clock card — this
          screen answers the parent's version of the same question. */}
      <View className="flex-row items-center gap-2">
        <View
          testID="today-nanny-live-dot"
          className="h-[7px] w-[7px] rounded-full bg-highlight"
        />
        <Body className="font-semibold">{t('nannyLiveTitle')}</Body>
      </View>
      <Body className="text-muted-foreground">
        {t('nannyLiveBody', {
          time: formatClockTime(running.clock_in_at, timeZone),
        })}
      </Body>
    </Card>
  );
}
