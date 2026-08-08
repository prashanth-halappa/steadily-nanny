/**
 * @module domains/timesheet/components/TimeEntryDayRow
 * One day's row on the Hours screen: the weekday + date, the clocked-in/out
 * times (or "in progress" for a still-running entry), and the day's total.
 *
 * Zero-duration finished entries show a warning flag.
 *
 * Daylight UX P0-2 — tapping an entry is now the carer's correction path
 * (`onEditEntry`, wired only by `NannyWeekView`; the parent's identical row
 * stays read-only). An entry that can no longer be corrected — still
 * running, or in a week the parent approved — is not pressable, and a
 * zero-duration one falls back to the explainer dialog it always had. A
 * corrected entry is marked, so the other party is never shown a silently
 * changed pay figure.
 *
 * Parent CX: day label includes the calendar date; "Today" marker; future
 * empty days say "Not yet"; zero-entry days drop elevation.
 *
 * Overnight finishes append a quiet "+1" when the clock-out's household-zone
 * local date is later than the day row — otherwise "11:53 PM – 10:26 PM"
 * reads as a backwards same-day shift.
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
import { localDateInZone } from '@/src/lib/localDate';
import { useElevation } from '~/lib/design-tokens/elevation';
import type { TimeEntry, TimesheetStatus } from '../types';
import { formatClockTime, formatDuration } from '../utils/duration';
import { isEntryEditable, wasEntryEdited } from '../utils/entryEdited';
import { computeEntryMinutes } from '../utils/entryMinutes';
import { endsAtLocalMidnight } from '../utils/splitFragment';
import { formatDisplayDate } from '../utils/week';

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
  const elevation = useElevation();
  const todayISO = localDateInZone(timeZone, new Date(nowMs));
  const isToday = date === todayISO;
  const isFuture = date > todayISO;
  const isEmpty = entries.length === 0;

  return (
    <View
      testID={testID}
      className={cn(
        'mb-2 flex-row items-center justify-between rounded-row px-3 py-3',
        isEmpty ? 'bg-transparent' : 'bg-card'
      )}
      style={isEmpty ? undefined : elevation.row}
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Body
            weight={isEmpty ? 'regular' : 'medium'}
            className={isEmpty ? 'text-muted-foreground' : undefined}
          >
            {`${t(`schedule:weekday.${weekdayDow(date)}`)} ${formatDisplayDate(date)}`}
          </Body>
          {isToday ? (
            <Small testID="hours-day-today" className="text-primary">
              {t('todayMarker')}
            </Small>
          ) : null}
        </View>
        {isEmpty ? (
          <Small className="text-muted-foreground">
            {isFuture ? t('notYet') : t('noHoursLogged')}
          </Small>
        ) : (
          entries.map(entry => {
            const isVoided = entry.status === 'voided';
            // A FINISHED entry (has clock_out_at) that computes to 0 minutes
            // is real but suspicious — e.g. an accidental clock-in/out
            // within the same second. Flag it distinctly rather than
            // letting it sit indistinguishable from a genuinely short
            // shift in a list of real hours (team-lead callout, 2026-08-01).
            // A still-running entry with 0 elapsed is normal (just started)
            // and is NOT flagged. Neither is the first fragment of a session
            // the server split at midnight: clocking in at 23:59:40 leaves it
            // 20 seconds long, which is the split working, not a misfire.
            const entryMinutes = computeEntryMinutes(entry, nowMs);
            // A cancellation fragment that rounded to nothing is exempt too:
            // its minutes are the window's residual, and zero is a legitimate
            // outcome of paying the window exactly once.
            const isZeroDuration =
              !isVoided &&
              !!entry.clock_out_at &&
              entryMinutes === 0 &&
              entry.kind !== 'cancellation_paid' &&
              !endsAtLocalMidnight(entry);
            // Compare finish to the ROW date in the household zone — never
            // the device zone (GOLDEN-FIXES #21). A later local date means
            // the range spans midnight and needs the quiet "+1" clarifier.
            const finishesNextDay =
              !!entry.clock_out_at &&
              localDateInZone(timeZone, new Date(entry.clock_out_at)) > date;
            const canEdit =
              !!onEditEntry && isEntryEditable(entry, timesheetStatus);
            const label = (
              <Small
                testID={
                  isVoided
                    ? `hours-voided-entry-${entry.id}`
                    : isZeroDuration
                      ? 'hours-zero-duration-flag'
                      : undefined
                }
                weight={isZeroDuration ? 'medium' : 'regular'}
                className={cn(
                  'text-muted-foreground',
                  isVoided && 'line-through',
                  isZeroDuration && 'text-warning'
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
                {finishesNextDay ? ` ${t('nextDayMarker')}` : ''}
                {isZeroDuration ? ` – ${t('flaggedCheckEntry')}` : ''}
                {isVoided ? ` · ${t('voided')}` : ''}
                {!isVoided && wasEntryEdited(entry) ? ` · ${t('edited')}` : ''}
              </Small>
            );
            // Voided rows stay visible for the audit trail but are never
            // pressable — voiding is final and earns nothing.
            if (isVoided) {
              return <View key={entry.id}>{label}</View>;
            }
            // Correcting it beats being told why it looks odd, so an
            // editable entry goes to the sheet even when flagged; the
            // explainer is the fallback for one that can no longer be fixed.
            if (canEdit) {
              return (
                <Pressable
                  key={entry.id}
                  testID={`hours-edit-entry-${entry.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('editEntry')}
                  onPress={() => onEditEntry?.(entry)}
                >
                  {label}
                </Pressable>
              );
            }
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
        {totalMinutes > 0 || entries.length > 0
          ? formatDuration(totalMinutes)
          : formatDuration(0)}
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
