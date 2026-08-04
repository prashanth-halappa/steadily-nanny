/**
 * @module domains/schedule/components/ThisWeeksShiftsCard
 *
 * Today "Next up" card — next two upcoming shifts so Today has a future tense.
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { Body, Small } from '@/src/components/ui/typography';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { formatInstantDisplay, wallClockToUtcIso } from '@/src/lib/wallClock';
import { useElevation } from '~/lib/design-tokens/elevation';

function weekdayDow(dateISO: string): number {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getDay();
}

function formatShiftLine(
  shift: Shift,
  timeZone: string,
  t: (key: string) => string
): string {
  const day = `${t(`weekday.${weekdayDow(shift.local_date)}`)} ${formatDisplayDate(shift.local_date)}`;
  const start = formatInstantDisplay(shift.starts_at, timeZone);
  const end = formatInstantDisplay(shift.ends_at, timeZone);
  return `${day} · ${start}–${end}`;
}

export function ThisWeeksShiftsCard() {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const elevation = useElevation();
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const today = localDateInZone(timeZone);
  const from = wallClockToUtcIso(today, '00:00', timeZone);
  const to = wallClockToUtcIso(addLocalDays(today, 14), '00:00', timeZone);
  const shiftsQuery = useShiftsRange(active.householdId, from, to);

  const nextShifts = useMemo(() => {
    const now = Date.now();
    return (shiftsQuery.data ?? [])
      .filter(
        s => s.status !== 'cancelled' && new Date(s.ends_at).getTime() >= now
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 2);
  }, [shiftsQuery.data]);

  return (
    <Card
      testID="today-shifts-card"
      className="gap-2 p-5.5"
      style={elevation.card}
    >
      <Body className="font-semibold">{t('todayCard.nextUpTitle')}</Body>
      {nextShifts.length === 0 ? (
        <Small className="text-muted-foreground">
          {t('todayCard.nextUpEmpty')}
        </Small>
      ) : (
        nextShifts.map(shift => (
          <Pressable
            key={shift.id}
            testID={`today-next-up-${shift.id}`}
            accessibilityRole="button"
            onPress={() =>
              router.push(`/(private)/schedule/shifts/${shift.id}` as Href)
            }
          >
            <Body className="text-foreground">
              {formatShiftLine(shift, timeZone, t)}
            </Body>
          </Pressable>
        ))
      )}
      <Pressable
        testID="today-shifts-cta"
        accessibilityRole="button"
        onPress={() => router.push('/(private)/schedule/shifts' as Href)}
      >
        <Small className="text-primary">{t('todayCard.viewCalendar')}</Small>
      </Pressable>
    </Card>
  );
}
