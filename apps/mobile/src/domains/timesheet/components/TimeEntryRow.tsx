/**
 * @module domains/timesheet/components/TimeEntryRow
 * One time entry as its own card on the Hours screen.
 *
 * The entry used to be a substring: a single concatenated line of times,
 * markers and flags, with the tap target only as tall as that text and the
 * day's total the only duration on screen. Here each entry is an object —
 * its own elevated card, its own duration, a 44pt target, and a chevron
 * that means "this can be corrected".
 *
 * Metadata lives in slots, not in the string: `+1` stays inside the time
 * range (it modifies the time), while "edited" and the zero-duration flag
 * are pills beside it.
 */
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Body, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import { AnimatedPressable } from '~/lib/animations';
import { spacing } from '~/lib/design-tokens';
import { useElevation } from '~/lib/design-tokens/elevation';
import type { TimeEntry } from '../types';
import { formatClockTime, formatDuration } from '../utils/duration';
import { wasEntryEdited } from '../utils/entryEdited';
import { computeEntryMinutes } from '../utils/entryMinutes';
import { endsAtLocalMidnight } from '../utils/splitFragment';

/**
 * Width of the disclosure chevron. Reserved even when the chevron is
 * absent, and exported so the day header can mirror this row's right-hand
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
  onPress?: () => void;
  onFlagPress?: () => void;
}

/**
 * Everything the row's shape depends on, derived once. Both the card shell
 * and its contents need these; deriving them twice is how the two halves
 * end up disagreeing about whether an entry is flagged.
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
  onPress,
  onFlagPress,
}: TimeEntryRowProps) {
  const { t } = useTranslation('hours');
  const elevation = useElevation();
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
      className={cn('rounded-row p-3', isRunning ? undefined : 'bg-card')}
      style={[
        // Apricot is the live-clock state and nothing else. Applied the way
        // `components/ui/card.tsx` already does it, and INSTEAD of the flat
        // row shadow rather than on top of it.
        isRunning
          ? {
              ...elevation.liveCard,
              backgroundColor: elevation.liveCardBackground,
            }
          : elevation.row,
        { minHeight: spacing.minTouchTarget },
      ]}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Small
              testID={
                isVoided
                  ? `hours-voided-entry-${entry.id}`
                  : isZeroDuration
                    ? 'hours-zero-duration-flag'
                    : `hours-entry-time-${entry.id}`
              }
              weight={isZeroDuration ? 'medium' : 'regular'}
              className={cn(
                'text-muted-foreground',
                isVoided && 'line-through',
                isZeroDuration && 'text-warning'
              )}
              tabular
            >
              {timeRange}
              {isVoided ? ` · ${t('voided')}` : null}
            </Small>
            {isZeroDuration ? (
              <StatusPill
                testID={`hours-entry-flag-pill-${entry.id}`}
                variant="pending"
                label={t('flaggedCheckEntry')}
              />
            ) : null}
            {showEdited ? (
              <StatusPill
                testID={`hours-entry-edited-pill-${entry.id}`}
                variant="cancelled"
                label={t('edited')}
              />
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
          <Body
            testID={`hours-entry-duration-${entry.id}`}
            weight="medium"
            tabular
          >
            {formatDuration(minutes)}
          </Body>
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
    </View>
  );

  if (isPressable) {
    return (
      <AnimatedPressable
        testID={`hours-edit-entry-${entry.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('editEntry')}
        onPress={onPress}
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
      >
        {content}
      </Pressable>
    );
  }

  return content;
}
