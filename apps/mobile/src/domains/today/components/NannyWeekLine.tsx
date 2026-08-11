/**
 * @module domains/today/components/NannyWeekLine
 *
 * The nanny's pay-at-a-glance on Today — hours logged this week and where
 * that week stands with the family. A quiet pressable line on the bare
 * ground (T4, same treatment as `ThisWeeksShiftsCard`); only a queried
 * timesheet earns a `Card` — the family disputing her pay is the one fact
 * that warrants elevation without her having done anything.
 */
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { Card, CardContent } from '@/src/components/ui/card';
import { Small } from '@/src/components/ui/typography';
import { timesheetPillLabel } from '@/src/domains/timesheet/components/WeekTotal';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import { sumEntryMinutes } from '@/src/domains/timesheet/utils/entryMinutes';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { useAuthStore } from '@/src/store/auth';

interface NannyWeekLineProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21). */
  timeZone: string;
  /** Household `week_starts_on` (0=Sunday..6=Saturday) — the week this line
   * totals is the household's business week, not a hardcoded Monday. */
  weekStartsOn: number;
}

export function NannyWeekLine({
  householdId,
  timeZone,
  weekStartsOn,
}: NannyWeekLineProps) {
  const { t: tToday } = useTranslation('today');
  const { t: tHours } = useTranslation('hours');
  const router = useRouter();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone, weekStartsOn),
    [timeZone, weekStartsOn]
  );
  const entriesQuery = useWeekTimeEntries(householdId, weekStart);
  const timesheetQuery = useWeekTimesheet(householdId, weekStart);

  if (
    entriesQuery.isLoading ||
    entriesQuery.isPending ||
    timesheetQuery.isLoading ||
    timesheetQuery.isPending
  ) {
    return null;
  }

  const entries = (entriesQuery.data ?? []).filter(
    entry => entry.carer_id === currentUserId
  );
  const totalMinutes = sumEntryMinutes(entries, Date.now());
  const duration = formatDuration(totalMinutes);
  const timesheet = currentUserId
    ? ((timesheetQuery.data ?? []).find(t => t.carer_id === currentUserId) ??
      null)
    : null;
  const timesheetStatus = timesheet?.status ?? null;
  // The SAME mapping the Hours tab renders — a second copy of it is how
  // two surfaces start disagreeing about one fact, which is the whole
  // bug class this screen was rebuilt to remove.
  const statusLabel = timesheetPillLabel(timesheetStatus, 'nanny', tHours);
  const lineText = `${tToday('weekLine', { duration })} · ${statusLabel}`;

  const goToHours = () => router.push('/(private)/(tabs)/hours' as Href);

  if (timesheetStatus === 'queried') {
    return (
      <Card testID="today-week-line-card" tone="attention">
        <CardContent className="py-3">
          <Pressable
            testID="today-week-line-card-press"
            accessibilityRole="button"
            onPress={goToHours}
          >
            <Small className="text-foreground">{lineText}</Small>
          </Pressable>
        </CardContent>
      </Card>
    );
  }

  return (
    <Pressable
      testID="today-week-line"
      accessibilityRole="button"
      onPress={goToHours}
    >
      <Small className="text-primary">{lineText}</Small>
    </Pressable>
  );
}
