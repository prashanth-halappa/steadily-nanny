/**
 * @module domains/timesheet/components/TimeEntryDayRow
 * One day's row on the Hours screen: the weekday, the clocked-in/out times
 * (or "in progress" for a still-running entry), and the day's total.
 */
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { Body, Small } from '@/src/components/ui/typography';
import type { TimeEntry } from '../types';
import { formatClockTime, formatDuration } from '../utils/duration';
import { computeEntryMinutes } from '../utils/entryMinutes';

interface TimeEntryDayRowProps {
  /** ISO `yyyy-mm-dd`, local calendar day. */
  date: string;
  entries: TimeEntry[];
  nowMs: number;
  testID?: string;
}

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function weekdayLabel(dateISO: string): string {
  const [year, month, day] = dateISO.split('-').map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return WEEKDAY_LABELS[date.getDay()] ?? dateISO;
}

export function TimeEntryDayRow({
  date,
  entries,
  nowMs,
  testID,
}: TimeEntryDayRowProps) {
  const totalMinutes = entries.reduce(
    (sum, entry) => sum + computeEntryMinutes(entry, nowMs),
    0
  );
  const isRunning = entries.some(entry => entry.status === 'running');

  return (
    <View
      testID={testID}
      className="flex-row items-center justify-between border-border border-b py-3"
    >
      <View className="gap-1">
        <Body className="font-sora-medium">{weekdayLabel(date)}</Body>
        {entries.length === 0 ? (
          <Small className="text-muted-foreground">No hours logged</Small>
        ) : (
          entries.map(entry => (
            <Small key={entry.id} className="text-muted-foreground">
              {entry.clock_in_at ? formatClockTime(entry.clock_in_at) : '—'}
              {' – '}
              {entry.clock_out_at
                ? formatClockTime(entry.clock_out_at)
                : 'in progress'}
            </Small>
          ))
        )}
      </View>
      <Body
        className={cn(
          'font-sora-medium',
          isRunning ? 'text-primary' : 'text-foreground'
        )}
      >
        {totalMinutes > 0 || entries.length > 0
          ? formatDuration(totalMinutes)
          : ''}
      </Body>
    </View>
  );
}
