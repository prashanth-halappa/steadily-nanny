/**
 * @module domains/timesheet/components/TimeEntryDayRow
 * One day of the week's ledger (`docs/design/screens-hours.md` §4).
 *
 * This is a ledger and it must read like one: the day on the left, its
 * entries beneath it, and the day's total right-aligned and tabular in a
 * column shared with every other day. Seven day totals that do not share a
 * decimal position is the definition of a number that doesn't read as a
 * number — the total and the per-entry durations land in one column by
 * construction (both right-hand groups reserve `CHEVRON_SLOT`), not by a
 * hand-computed padding that the next spacing change would break.
 *
 * The row owns the ground and the elevation; the entries inside it are
 * lines, not cards (see `TimeEntryRow`'s header). A day with a still-running
 * entry takes the apricot live ground and a `LiveDot` — register 3 is valid
 * here, someone genuinely is on the clock.
 *
 * An approved week's entries lose their press affordance entirely rather
 * than showing one that will be refused (`onEditEntry` is simply not passed
 * — `NannyWeekView`), and the lock note stays at card level, once, never
 * repeated down the list.
 *
 * A5 — A DAY OF MORE THAN TWO PUNCHES COLLAPSES. Seven lines, five of them
 * under three minutes, two struck through, is the record and must stay
 * reachable; it must not be the first thing between a reader and everything
 * below it. Two rules the collapse never breaks:
 *
 * 1. A day with a RUNNING entry is always expanded. The live state is the
 *    one thing that must never be behind a tap.
 * 2. Nothing two parties could argue about is hidden. The voided and edited
 *    counts are the two facts a collapse would otherwise bury, so the
 *    summary PROMOTES them ("7 entries · 2 voided, not counted · 1 edited")
 *    rather than concealing them.
 *
 * The chevron goes INSIDE the already-reserved `CHEVRON_SLOT`, so the day
 * total lands in the same column whether or not the day can collapse.
 */
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
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
import { LiveDot } from '@/src/components/ui/live-dot';
import { Text } from '@/src/components/ui/text';
import { Figure, MetadataLabel, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import { useElevation } from '~/lib/design-tokens/elevation';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';
import type { TimeEntry, TimesheetStatus } from '../types';
import { formatDuration } from '../utils/duration';
import { isEntryEditable, wasEntryEdited } from '../utils/entryEdited';
import { computeEntryMinutes } from '../utils/entryMinutes';
import { formatDisplayDate } from '../utils/week';
import { CHEVRON_SLOT, TimeEntryRow } from './TimeEntryRow';

/** §4: a ledger row is at least 56pt tall, whatever it happens to contain. */
const ROW_MIN_HEIGHT = 56;

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
  const elevation = useElevation();
  const colors = useThemeColors();
  const [flagExplainerOpen, setFlagExplainerOpen] = useState(false);
  const totalMinutes = entries.reduce(
    (sum, entry) => sum + computeEntryMinutes(entry, nowMs),
    0
  );
  const isRunning = entries.some(entry => entry.status === 'running');
  const isCollapsible = entries.length > 2 && !isRunning;
  const [expanded, setExpanded] = useState(false);
  const showEntries = !isCollapsible || expanded;
  const todayISO = localDateInZone(timeZone, new Date(nowMs));
  const isToday = date === todayISO;
  const isFuture = date > todayISO;
  const isEmpty = entries.length === 0;
  const voidedCount = entries.filter(e => e.status === 'voided').length;
  const editedCount = entries.filter(wasEntryEdited).length;
  const daySummary = [
    t('daySummaryEntries', { count: entries.length }),
    voidedCount > 0 ? t('daySummaryVoided', { count: voidedCount }) : null,
    editedCount > 0 ? t('daySummaryEdited', { count: editedCount }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View testID={testID} className="mb-2">
      <View
        className={cn(
          'rounded-row px-4 py-3',
          isRunning ? undefined : 'bg-card'
        )}
        style={[
          // Apricot is the live-clock state and nothing else, applied INSTEAD
          // of the flat row shadow rather than on top of it.
          isRunning
            ? { ...elevation.liveCard, backgroundColor: colors.surfaceLive }
            : elevation.row,
          { minHeight: ROW_MIN_HEIGHT },
        ]}
      >
        <Pressable
          testID={isEmpty ? undefined : 'hours-day-header'}
          accessibilityRole={isCollapsible ? 'button' : undefined}
          accessibilityState={isCollapsible ? { expanded } : undefined}
          onPress={isCollapsible ? () => setExpanded(open => !open) : undefined}
          className="flex-row items-center justify-between gap-3"
        >
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <MetadataLabel
              className={
                isRunning ? 'text-muted-strong' : 'text-muted-foreground'
              }
            >
              {`${t(`schedule:weekday.${weekdayDow(date)}`)} ${formatDisplayDate(date)}`}
            </MetadataLabel>
            {isToday ? (
              <Small testID="hours-day-today" className="text-primary">
                {t('todayMarker')}
              </Small>
            ) : null}
            {isRunning ? <LiveDot testID="hours-day-live" /> : null}
          </View>
          {/* Mirrors TimeEntryRow's right-hand group exactly — figure, 8px
              gap, reserved chevron slot — so the day total lands in the same
              column as the per-entry durations it sums. */}
          <View className="flex-shrink-0 flex-row items-center gap-2">
            <Figure
              testID="hours-day-total"
              weight={isEmpty ? 'regular' : 'medium'}
              className={cn(
                isEmpty ? 'text-muted-foreground' : 'text-foreground'
              )}
            >
              {formatDuration(totalMinutes)}
            </Figure>
            {/* The slot is reserved either way — the chevron goes in it, so
                a column of day totals does not shift by 20px depending on
                whether the day happens to be busy. */}
            <View
              testID={isCollapsible ? 'hours-day-chevron' : undefined}
              style={{ width: CHEVRON_SLOT }}
            >
              {isCollapsible ? (
                <Icon
                  icon={expanded ? ChevronUp : ChevronDown}
                  size={CHEVRON_SLOT}
                  className="text-muted-foreground"
                />
              ) : null}
            </View>
          </View>
        </Pressable>

        {isEmpty ? (
          <Small className="mt-1 text-muted-foreground">
            {isFuture ? t('notYet') : t('noHoursLogged')}
          </Small>
        ) : showEntries ? (
          <View className="mt-1.5 gap-2">
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
                  // One entry: the day total above IS this entry's duration.
                  showDuration={entries.length > 1}
                  onPress={canEdit ? () => onEditEntry?.(entry) : undefined}
                  onFlagPress={() => setFlagExplainerOpen(true)}
                />
              );
            })}
          </View>
        ) : (
          <Small
            testID="hours-day-summary"
            className="mt-1 text-muted-foreground"
          >
            {daySummary}
          </Small>
        )}
      </View>

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
