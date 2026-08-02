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
import { Body } from '@/src/components/ui/typography';
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
    <View
      testID="today-nanny-live-status"
      className="gap-1 rounded-xl border border-border bg-card p-4"
    >
      <Body className="font-sora-semibold">{t('nannyLiveTitle')}</Body>
      <Body className="text-muted-foreground">
        {t('nannyLiveBody', { time: formatClockTime(running.clock_in_at) })}
      </Body>
    </View>
  );
}
