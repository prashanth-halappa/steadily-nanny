/**
 * @module domains/timesheet/components/TimeEntryDayRow
 * One day's section on the Hours screen: header (weekday + date + total)
 * and a stack of per-entry cards (`TimeEntryRow`).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
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
import { Body, DayGroup, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import type { TimeEntry, TimesheetStatus } from '../types';
import { formatDuration } from '../utils/duration';
import { isEntryEditable } from '../utils/entryEdited';
import { computeEntryMinutes } from '../utils/entryMinutes';
import { formatDisplayDate } from '../utils/week';
import { CHEVRON_SLOT, TimeEntryRow } from './TimeEntryRow';

interface TimeEntryDayRowProps {
  /** ISO `yyyy-mm-dd`, local calendar day. */
  date: string;
  entries: TimeEntry[];
  nowMs: number;
  /** Household IANA zone — the clock-in/out times render in THIS zone, never
   * the device's (GOLDEN-FIXES #21 bug class; see utils/week.ts's header). */
  timeZone: string;
  /** Opens the correction sheet. Omitted on the parent's side, which makes
   * every entry read-only there. */
  onEditEntry?: (entry: TimeEntry) => void;
  /** The week's approval state — an approved week is not correctable. */
  timesheetStatus?: TimesheetStatus | null;
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
  onEditEntry,
  timesheetStatus,
  testID,
}: TimeEntryDayRowProps) {
  const { t } = useTranslation('hours');
  const [flagExplainerOpen, setFlagExplainerOpen] = useState(false);
  const totalMinutes = entries.reduce(
    (sum, entry) => sum + computeEntryMinutes(entry, nowMs),
    0
  );
  const isRunning = entries.some(entry => entry.status === 'running');
  const todayISO = localDateInZone(timeZone, new Date(nowMs));
  const isToday = date === todayISO;
  const isFuture = date > todayISO;
  const isEmpty = entries.length === 0;

  return (
    <View testID={testID} className="mb-2">
      <View
        testID={isEmpty ? undefined : 'hours-day-header'}
        className="mb-2 flex-row items-center justify-between pr-3"
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <DayGroup
            weight={isEmpty ? 'regular' : 'medium'}
            className={isEmpty ? 'text-muted-foreground' : undefined}
          >
            {`${t(`schedule:weekday.${weekdayDow(date)}`)} ${formatDisplayDate(date)}`}
          </DayGroup>
          {isToday ? (
            <Small testID="hours-day-today" className="text-primary">
              {t('todayMarker')}
            </Small>
          ) : null}
        </View>
        {/* Mirrors TimeEntryRow's right-hand group exactly — figure, 8px
            gap, reserved chevron slot — so the day total lands in the same
            column as the per-entry durations it sums. Aligning by shared
            structure survives a padding change; aligning by a hand-computed
            pr-* value does not. */}
        <View className="flex-shrink-0 flex-row items-center gap-2">
          <Body
            testID="hours-day-total"
            weight={isEmpty ? 'regular' : 'semibold'}
            className={cn(
              isRunning
                ? 'text-primary'
                : isEmpty
                  ? 'text-muted-foreground'
                  : 'text-foreground'
            )}
            tabular
          >
            {formatDuration(totalMinutes)}
          </Body>
          <View style={{ width: CHEVRON_SLOT }} />
        </View>
      </View>

      {isEmpty ? (
        <Small className="text-muted-foreground">
          {isFuture ? t('notYet') : t('noHoursLogged')}
        </Small>
      ) : (
        <View className="gap-2">
          {entries.map(entry => {
            const canEdit =
              !!onEditEntry && isEntryEditable(entry, timesheetStatus);
            return (
              <TimeEntryRow
                key={entry.id}
                entry={entry}
                nowMs={nowMs}
                timeZone={timeZone}
                dayDate={date}
                onPress={canEdit ? () => onEditEntry?.(entry) : undefined}
                onFlagPress={() => setFlagExplainerOpen(true)}
              />
            );
          })}
        </View>
      )}

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
