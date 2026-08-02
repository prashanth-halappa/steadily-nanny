/**
 * @module domains/timesheet/components/TimeEntryDayRow
 * One day's row on the Hours screen: the weekday, the clocked-in/out times
 * (or "in progress" for a still-running entry), and the day's total.
 *
 * Zero-duration finished entries show a warning flag; tapping opens an
 * explanation dialog (read-only — no edit API in this wave).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { Text } from '@/src/components/ui/text';
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
  const { t } = useTranslation('hours');
  const [flagExplainerOpen, setFlagExplainerOpen] = useState(false);
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
        <Body className="font-medium">{weekdayLabel(date)}</Body>
        {entries.length === 0 ? (
          <Small className="text-muted-foreground">No hours logged</Small>
        ) : (
          entries.map(entry => {
            // A FINISHED entry (has clock_out_at) that computes to 0 minutes
            // is real but suspicious — e.g. an accidental clock-in/out
            // within the same second. Flag it distinctly rather than
            // letting it sit indistinguishable from a genuinely short
            // shift in a list of real hours (team-lead callout, 2026-08-01).
            // A still-running entry with 0 elapsed is normal (just started)
            // and is NOT flagged.
            const entryMinutes = computeEntryMinutes(entry, nowMs);
            const isZeroDuration = !!entry.clock_out_at && entryMinutes === 0;
            const label = (
              <Small
                testID={isZeroDuration ? 'hours-zero-duration-flag' : undefined}
                className={cn(
                  'text-muted-foreground',
                  isZeroDuration && 'font-medium text-warning'
                )}
                tabular
              >
                {entry.clock_in_at ? formatClockTime(entry.clock_in_at) : '—'}
                {' – '}
                {entry.clock_out_at
                  ? formatClockTime(entry.clock_out_at)
                  : 'in progress'}
                {isZeroDuration ? ` – ${t('flaggedCheckEntry')}` : ''}
              </Small>
            );
            if (!isZeroDuration) return <View key={entry.id}>{label}</View>;
            return (
              <Pressable
                key={entry.id}
                testID={`hours-flagged-entry-${entry.id}`}
                accessibilityRole="button"
                accessibilityLabel={t('flaggedCheckEntry')}
                onPress={() => setFlagExplainerOpen(true)}
              >
                {label}
              </Pressable>
            );
          })
        )}
      </View>
      <Body
        className={cn(
          'font-medium',
          isRunning ? 'text-primary' : 'text-foreground'
        )}
        tabular
      >
        {totalMinutes > 0 || entries.length > 0
          ? formatDuration(totalMinutes)
          : ''}
      </Body>

      <AlertDialog open={flagExplainerOpen} onOpenChange={setFlagExplainerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('flaggedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('flaggedDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              testID="hours-flagged-dismiss"
              onPress={() => setFlagExplainerOpen(false)}
            >
              <Text>{t('flaggedDismiss')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
