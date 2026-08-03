/**
 * @module domains/today/components/NannyLiveStatusCard
 *
 * Parent Today: answers "who is with my children today" in four states —
 * scheduled / arriving / on the clock / finished — with apricot live only
 * while a time entry is running (Daylight UX #6).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { Body } from '@/src/components/ui/typography';
import { formatClockTime } from '@/src/domains/timesheet/utils/duration';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

interface NannyLiveStatusCardProps {
  householdId: string;
  timeZone: string;
}

type TodayShiftState =
  | { kind: 'running'; clockInAt: string }
  | { kind: 'finished'; clockOutAt: string }
  | { kind: 'arriving'; start: string }
  | { kind: 'scheduled'; start: string; end: string }
  | { kind: 'none' };

const ARRIVING_WINDOW_MS = 60 * 60 * 1000;

export function NannyLiveStatusCard({
  householdId,
  timeZone,
}: NannyLiveStatusCardProps) {
  const { t } = useTranslation('today');
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

  const state: TodayShiftState = useMemo(() => {
    const running = (entries.data ?? []).find(e => e.status === 'running');
    if (running?.clock_in_at) {
      return { kind: 'running', clockInAt: running.clock_in_at };
    }

    const finishedToday = (entries.data ?? [])
      .filter(e => e.local_date === today && e.clock_out_at)
      .sort((a, b) =>
        (b.clock_out_at ?? '').localeCompare(a.clock_out_at ?? '')
      )[0];
    if (finishedToday?.clock_out_at) {
      return { kind: 'finished', clockOutAt: finishedToday.clock_out_at };
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
      };
    }
    if (now < startMs) {
      return {
        kind: 'scheduled',
        start: formatClockTime(next.starts_at, timeZone),
        end: formatClockTime(next.ends_at, timeZone),
      };
    }
    // Past scheduled end with no clock data — treat as finished window.
    return {
      kind: 'scheduled',
      start: formatClockTime(next.starts_at, timeZone),
      end: formatClockTime(next.ends_at, timeZone),
    };
  }, [entries.data, shifts.data, today, timeZone]);

  const live = state.kind === 'running';
  const title =
    state.kind === 'running'
      ? t('nannyLiveTitle')
      : state.kind === 'finished'
        ? t('nannyFinishedTitle')
        : state.kind === 'arriving'
          ? t('nannyArrivingTitle')
          : state.kind === 'scheduled'
            ? t('nannyScheduledTitle')
            : t('nannyNoShiftTitle');
  const body =
    state.kind === 'running'
      ? t('nannyLiveBody', {
          time: formatClockTime(state.clockInAt, timeZone),
        })
      : state.kind === 'finished'
        ? t('nannyFinishedBody', {
            time: formatClockTime(state.clockOutAt, timeZone),
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
    <Card testID="today-nanny-live-status" live={live} className="gap-1 p-5.5">
      <View className="flex-row items-center gap-2">
        {live ? (
          <View
            testID="today-nanny-live-dot"
            className="h-[10px] w-[10px] rounded-full bg-highlight"
          />
        ) : null}
        <Body className="font-semibold">{title}</Body>
      </View>
      <Body className="text-muted-foreground">{body}</Body>
    </Card>
  );
}
