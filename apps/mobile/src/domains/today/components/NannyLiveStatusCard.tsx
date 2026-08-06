/**
 * @module domains/today/components/NannyLiveStatusCard
 *
 * Parent Today: answers "who is with my children today" — names the carer,
 * shows duration when finished, and opens Hours on tap.
 */
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { LiveDot } from '@/src/components/ui/live-dot';
import { Body } from '@/src/components/ui/typography';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import { carerKeyOf } from '@/src/domains/timesheet/utils/carerKey';
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { sumEntryMinutes } from '@/src/domains/timesheet/utils/entryMinutes';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';

interface NannyLiveStatusCardProps {
  householdId: string;
  timeZone: string;
}

type TodayShiftState =
  | { kind: 'running'; clockInAt: string; carerId: string | null }
  | {
      kind: 'finished';
      clockOutAt: string;
      carerId: string | null;
      /** The row's own snapshot — the only name a departed carer still has. */
      carerDisplayName: string;
      durationLabel: string;
    }
  | { kind: 'arriving'; start: string; carerId: string | null }
  | {
      kind: 'scheduled';
      start: string;
      end: string;
      carerId: string | null;
    }
  | { kind: 'none' };

const ARRIVING_WINDOW_MS = 60 * 60 * 1000;

export function NannyLiveStatusCard({
  householdId,
  timeZone,
}: NannyLiveStatusCardProps) {
  const { t } = useTranslation('today');
  const { t: tSchedule } = useTranslation('schedule');
  const router = useRouter();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const membersQuery = useHouseholdMembers(householdId);
  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone),
    [timeZone]
  );
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

  const entries = useWeekTimeEntries(householdId, weekStart);
  const shifts = useShiftsRange(householdId, from, to);

  const membersByUserId = useMemo(
    () =>
      new Map(
        (membersQuery.data ?? []).map(member => [member.user_id, member])
      ),
    [membersQuery.data]
  );
  const memberLabels = useMemo(
    () => ({
      you: tSchedule('detail.you'),
      someone: tSchedule('detail.someone'),
      roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
        tSchedule(`detail.roleFallback.${role}`),
    }),
    [tSchedule]
  );
  const nameFor = (userId: string | null | undefined) =>
    resolveMemberDisplayName(
      userId,
      currentUserId,
      membersByUserId,
      memberLabels
    );

  const state: TodayShiftState = useMemo(() => {
    const nowMs = Date.now();
    const running = (entries.data ?? []).find(e => e.status === 'running');
    if (running?.clock_in_at) {
      return {
        kind: 'running',
        clockInAt: running.clock_in_at,
        carerId: running.carer_id,
      };
    }

    const finishedToday = (entries.data ?? [])
      .filter(e => e.local_date === today && e.clock_out_at)
      .sort((a, b) =>
        (b.clock_out_at ?? '').localeCompare(a.clock_out_at ?? '')
      )[0];
    if (finishedToday?.clock_out_at) {
      // Only THIS carer's entries — `finishedToday` names one carer, so the
      // duration next to her name must be hers alone, never every carer's
      // hours for the day summed under one name (F-B1-3-sibling). `carerKeyOf`
      // is the same identity rule the parent's week screen buckets tabs and
      // totals with, deliberately shared: a card that merges two carers the
      // week screen splits reports a day's hours under the wrong name.
      const finishedKey = carerKeyOf(finishedToday);
      const todayEntries = (entries.data ?? []).filter(
        e => e.local_date === today && carerKeyOf(e) === finishedKey
      );
      return {
        kind: 'finished',
        clockOutAt: finishedToday.clock_out_at,
        carerId: finishedToday.carer_id,
        carerDisplayName: finishedToday.carer_display_name,
        durationLabel: formatDuration(sumEntryMinutes(todayEntries, nowMs)),
      };
    }

    const todayShifts = (shifts.data ?? [])
      .filter(s => s.local_date === today && s.status !== 'cancelled')
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const next = todayShifts[0];
    if (!next) return { kind: 'none' };

    const startMs = new Date(next.starts_at).getTime();
    const now = Date.now();
    if (now < startMs && startMs - now <= ARRIVING_WINDOW_MS) {
      return {
        kind: 'arriving',
        start: formatClockTime(next.starts_at, timeZone),
        carerId: next.carer_id,
      };
    }
    return {
      kind: 'scheduled',
      start: formatClockTime(next.starts_at, timeZone),
      end: formatClockTime(next.ends_at, timeZone),
      carerId: next.carer_id,
    };
  }, [entries.data, shifts.data, today, timeZone]);

  // A departed carer has no user id left to resolve against the member list,
  // so `nameFor` would say "Someone" over hours the card has just correctly
  // attributed to her. Her row's snapshot is the name she still has. Only the
  // finished arm can carry one: a running entry needs a logged-in account, and
  // a shift names a member.
  const name =
    state.kind === 'none'
      ? ''
      : state.kind === 'finished' && state.carerId === null
        ? state.carerDisplayName
        : nameFor(state.carerId);

  const live = state.kind === 'running';
  const title =
    state.kind === 'running'
      ? t('nannyLiveTitle', { name })
      : state.kind === 'finished'
        ? t('nannyFinishedTitle', { name })
        : state.kind === 'arriving'
          ? t('nannyArrivingTitle', { name })
          : state.kind === 'scheduled'
            ? t('nannyScheduledTitle', { name })
            : t('nannyNoShiftTitle');
  const body =
    state.kind === 'running'
      ? t('nannyLiveBody', {
          time: formatClockTime(state.clockInAt, timeZone),
        })
      : state.kind === 'finished'
        ? t('nannyFinishedBody', {
            time: formatClockTime(state.clockOutAt, timeZone),
            duration: state.durationLabel,
          })
        : state.kind === 'arriving'
          ? t('nannyArrivingBody', { start: state.start })
          : state.kind === 'scheduled'
            ? t('nannyScheduledBody', {
                start: state.start,
                end: state.end,
              })
            : t('nannyNoShiftBody');

  return (
    <Pressable
      testID="today-nanny-live-status"
      accessibilityRole="button"
      onPress={() => router.push('/(private)/(tabs)/hours' as Href)}
    >
      <Card live={live} className="gap-1 p-5.5">
        <View className="flex-row items-center gap-2">
          {live ? <LiveDot testID="today-nanny-live-dot" /> : null}
          <Body weight="semibold">{title}</Body>
        </View>
        <Body className="text-muted-foreground">{body}</Body>
      </Card>
    </Pressable>
  );
}
