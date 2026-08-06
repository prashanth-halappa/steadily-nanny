/**
 * @module domains/schedule/components/ThisWeeksShiftsCard
 *
 * Today "Next up" card — next two upcoming shifts so Today has a future tense.
 * Whose shift it is only earns row space in a 2+ carer household; a one-carer
 * home is told once, under the title, and the rows stay a clean date column.
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { Body, Figure, Small } from '@/src/components/ui/typography';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { formatInstantDisplay, wallClockToUtcIso } from '@/src/lib/wallClock';
import { useElevation } from '~/lib/design-tokens/elevation';
import { spacing } from '~/lib/design-tokens/spacing';

function weekdayDow(dateISO: string): number {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getDay();
}

function formatShiftLine(
  shift: Shift,
  timeZone: string,
  t: (key: string) => string
): string {
  // Short weekday: the row now shares its width with a carer name, and
  // "Wednesday 6 Aug · 1:00–9:00 AM" is what pushed it onto two lines.
  const day = `${t(`weekdayShort.${weekdayDow(shift.local_date)}`)} ${formatDisplayDate(shift.local_date)}`;
  const start = formatInstantDisplay(shift.starts_at, timeZone);
  const end = formatInstantDisplay(shift.ends_at, timeZone);
  return `${day} · ${start}–${end}`;
}

/** First token only — the rows are narrow, and a surname adds no clarity. */
function firstNameOf(name: string): string {
  return name.split(' ')[0] ?? name;
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
  const membersQuery = useHouseholdMembers(active.householdId);

  const nextShifts = useMemo(() => {
    const now = Date.now();
    return (shiftsQuery.data ?? [])
      .filter(
        s => s.status !== 'cancelled' && new Date(s.ends_at).getTime() >= now
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 2);
  }, [shiftsQuery.data]);

  const carers = useMemo(
    () => (membersQuery.data ?? []).filter(m => m.role === 'nanny'),
    [membersQuery.data]
  );
  const carersByUserId = useMemo(
    () => new Map<string, HouseholdMember>(carers.map(m => [m.user_id, m])),
    [carers]
  );
  // Empty fallback: an unresolvable carer contributes no label at all rather
  // than a role word standing in for a name.
  const nameFor = (carerId: string | null) =>
    carerId ? resolveCarerName(carersByUserId.get(carerId), '') : '';
  const soleCarerName =
    carers.length === 1 ? nameFor(carers[0]?.user_id ?? '') : '';

  return (
    <Card
      testID="today-shifts-card"
      className="gap-2 p-5.5"
      style={elevation.card}
    >
      <Body weight="semibold">{t('todayCard.nextUpTitle')}</Body>
      {soleCarerName ? (
        <Small testID="today-next-up-carer" className="text-muted-foreground">
          {soleCarerName}
        </Small>
      ) : null}
      {nextShifts.length === 0 ? (
        <Small className="text-muted-foreground">
          {t('todayCard.nextUpEmpty')}
        </Small>
      ) : (
        nextShifts.map(shift => {
          const carerName =
            carers.length > 1 ? firstNameOf(nameFor(shift.carer_id)) : '';
          return (
            <Pressable
              key={shift.id}
              testID={`today-next-up-${shift.id}`}
              accessibilityRole="button"
              className="flex-row items-center justify-between gap-3 py-1.5"
              style={{ minHeight: spacing.minTouchTarget }}
              hitSlop={8}
              onPress={() =>
                router.push(`/(private)/schedule/shifts/${shift.id}` as Href)
              }
            >
              <Figure
                testID={`today-next-up-line-${shift.id}`}
                className="text-foreground"
              >
                {formatShiftLine(shift, timeZone, t)}
              </Figure>
              {carerName ? (
                <Small
                  testID={`today-next-up-carer-${shift.id}`}
                  className="max-w-[38%] flex-shrink-0 text-muted-foreground"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {carerName}
                </Small>
              ) : null}
            </Pressable>
          );
        })
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
