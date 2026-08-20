/**
 * @module domains/timesheet/components/TimeEntryRow
 * One time entry, as a LINE inside its day's ledger row.
 *
 * The entry used to be a substring: a single concatenated line of times,
 * markers and flags, with the tap target only as tall as that text. Then it
 * became its own elevated card — which, stacked seven deep under a day
 * header that was also a card, made the Hours screen a pile of containers
 * rather than a ledger. Daylight v2 (`docs/design/screens-hours.md` §4) puts
 * the ground and the elevation on the DAY (`TimeEntryDayRow`) and leaves
 * this as the line inside it: the times, whatever qualifies them, and the
 * chevron that means "this can be corrected".
 *
 * Metadata lives in slots, not in the string: `+1` stays inside the time
 * range (it modifies the time), while "Edited" and the zero-duration flag
 * are markers beside it. "Edited" is a `MetadataLabel`, not a pill — who
 * changed a recorded hour is the thing two parties argue about, so the
 * record states it plainly on the row rather than only inside a sheet.
 *
 * `showDuration` is false on a single-entry day, where the day's own total
 * (right-aligned, one column) already IS this entry's duration and printing
 * it twice makes a reader check whether the two numbers agree.
 */
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Body, MetadataLabel, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import { AnimatedPressable } from '~/lib/animations';
import type { TimeEntry } from '../types';
import { formatClockTime, formatDuration } from '../utils/duration';
import { wasEntryEdited } from '../utils/entryEdited';
import { computeEntryMinutes } from '../utils/entryMinutes';
import { endsAtLocalMidnight } from '../utils/splitFragment';

/**
 * Width of the disclosure chevron. Reserved even when the chevron is
 * absent, and exported so the day header can mirror this line's right-hand
 * group — that is what puts the day total and the per-entry durations in
 * one column by construction rather than by arithmetic.
 */
export const CHEVRON_SLOT = 20;

interface TimeEntryRowProps {
  entry: TimeEntry;
  nowMs: number;
  timeZone: string;
  /** ISO `yyyy-mm-dd` of the day row this entry belongs to. */
  dayDate: string;
  /** Only on a multi-entry day — see module header. */
  showDuration?: boolean;
  onPress?: () => void;
  onFlagPress?: () => void;
}

/**
 * Everything the line's shape depends on, derived once. Both the pressable
 * shell and its contents need these; deriving them twice is how the two
 * halves end up disagreeing about whether an entry is flagged.
 */
function deriveEntryState(entry: TimeEntry, nowMs: number) {
  const isVoided = entry.status === 'voided';
  const minutes = computeEntryMinutes(entry, nowMs);
  return {
    isVoided,
    minutes,
    isRunning: entry.status === 'running',
    // A FINISHED entry that computes to 0 minutes is real but suspicious —
    // an accidental clock-in/out within the same second. A still-running
    // 0-minute entry is normal, a `cancellation_paid` residual is a
    // legitimate zero, and a midnight split fragment is the split working.
    isZeroDuration:
      !isVoided &&
      !!entry.clock_out_at &&
      minutes === 0 &&
      entry.kind !== 'cancellation_paid' &&
      !endsAtLocalMidnight(entry),
  };
}

export function TimeEntryRow({
  entry,
  nowMs,
  timeZone,
  dayDate,
  showDuration = false,
  onPress,
  onFlagPress,
}: TimeEntryRowProps) {
  const { t } = useTranslation('hours');
  const { isVoided, isRunning, isZeroDuration, minutes } = deriveEntryState(
    entry,
    nowMs
  );

  const isPressable = !!onPress && !isVoided && !isRunning;
  const isFlagPressable = isZeroDuration && !isPressable && !!onFlagPress;
  const showEdited = !isVoided && wasEntryEdited(entry);

  const clockIn = entry.clock_in_at
    ? formatClockTime(entry.clock_in_at, timeZone)
    : '—';
  // Compare the finish to the ROW's date in the household zone, never the
  // device's (GOLDEN-FIXES #21).
  const finishesNextDay =
    !!entry.clock_out_at &&
    localDateInZone(timeZone, new Date(entry.clock_out_at)) > dayDate;
  // A DISCARDED clock-in has no finish and never will: voiding writes
  // `status` only. Drop the range rather than render "9:58 PM – in progress
  // · voided", which claims the entry is both running and withdrawn.
  const timeRange =
    isVoided && !entry.clock_out_at
      ? clockIn
      : `${clockIn} – ${
          entry.clock_out_at
            ? formatClockTime(entry.clock_out_at, timeZone)
            : t('inProgress')
        }${finishesNextDay ? ` ${t('nextDayMarker')}` : ''}`;

  const content = (
    <View
      testID={`hours-entry-row-${entry.id}`}
      className="flex-row items-center justify-between gap-2"
    >
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Body
            testID={
              isVoided
                ? `hours-voided-entry-${entry.id}`
                : isZeroDuration
                  ? 'hours-zero-duration-flag'
                  : `hours-entry-time-${entry.id}`
            }
            weight={isZeroDuration ? 'medium' : 'regular'}
            tabular
            className={cn(
              // T4: a voided entry is a complete record, but it must not
              // compete with a real one for weight.
              isVoided && 'text-muted-foreground line-through',
              isZeroDuration && 'text-foreground'
            )}
          >
            {timeRange}
            {isVoided ? ` · ${t('voided')}` : null}
          </Body>
          {isZeroDuration ? (
            <StatusPill
              testID={`hours-entry-flag-pill-${entry.id}`}
              variant="pending"
              label={t('flaggedCheckEntry')}
            />
          ) : null}
          {showEdited ? (
            <MetadataLabel
              testID={`hours-entry-edited-pill-${entry.id}`}
              className="text-muted-strong"
            >
              {t('editedMarker')}
            </MetadataLabel>
          ) : null}
        </View>
        {entry.break_minutes > 0 ? (
          <Small
            testID={`hours-entry-break-${entry.id}`}
            className="text-muted-foreground"
          >
            {t('entryBreak', { minutes: entry.break_minutes })}
          </Small>
        ) : null}
      </View>
      <View className="flex-shrink-0 flex-row items-center gap-2">
        {showDuration ? (
          <Body
            testID={`hours-entry-duration-${entry.id}`}
            tabular
            className={isVoided ? 'text-muted-foreground' : undefined}
          >
            {formatDuration(minutes)}
          </Body>
        ) : null}
        {/* The chevron IS the editability signal — same contract as
            SettingsNavRow. Its absence is why the parent's read-only view
            needs no extra copy. */}
        {/* The slot is reserved whether or not the chevron shows: a
            column of hours that shifts 20px depending on editability is
            the same ragged-figures defect this change exists to kill. */}
        <View style={{ width: CHEVRON_SLOT }}>
          {isPressable ? (
            <Icon
              icon={ChevronRight}
              size={CHEVRON_SLOT}
              className="text-muted-foreground"
            />
          ) : null}
        </View>
      </View>
    </View>
  );

  if (isPressable) {
    return (
      <AnimatedPressable
        testID={`hours-edit-entry-${entry.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('editEntry')}
        onPress={onPress}
        hitSlop={8}
      >
        {content}
      </AnimatedPressable>
    );
  }

  if (isFlagPressable) {
    return (
      <Pressable
        testID={`hours-flagged-entry-${entry.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('flaggedCheckEntry')}
        onPress={onFlagPress}
        hitSlop={8}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}
