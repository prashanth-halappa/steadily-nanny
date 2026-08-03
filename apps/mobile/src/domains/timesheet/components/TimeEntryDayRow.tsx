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
  /** Household IANA zone — the clock-in/out times render in THIS zone, never
   * the device's (GOLDEN-FIXES #21 bug class; see utils/week.ts's header). */
  timeZone: string;
  testID?: string;
}

function weekdayDow(dateISO: string): number {
  const [year, month, day] = dateISO.split('-').map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return date.getDay();
}

export function TimeEntryDayRow({
  date,
  entries,
  nowMs,
  timeZone,
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
        <Body className="font-medium">
          {t(`schedule:weekday.${weekdayDow(date)}`)}
        </Body>
        {entries.length === 0 ? (
          <Small className="text-muted-foreground">{t('noHoursLogged')}</Small>
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
                {entry.clock_in_at
                  ? formatClockTime(entry.clock_in_at, timeZone)
                  : '—'}
                {' – '}
                {entry.clock_out_at
                  ? formatClockTime(entry.clock_out_at, timeZone)
                  : t('inProgress')}
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
