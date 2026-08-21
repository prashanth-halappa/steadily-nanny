/**
 * @module domains/today/components/AddMissedHoursCard
 *
 * Forgotten clock-in recovery: a slim CTA on the carer's Today screen opens
 * `MissedHoursSheet` (date, start/end, optional note, submits via
 * `useCreateRetroactiveEntry`) defaulted to today at 09:00–17:00. This file
 * owns only the CTA and the GATING (`showCta`) — the sheet itself lives in
 * `MissedHoursSheet` so `ClockInCard`'s specific ended-shift prompt can open
 * the same one instead of building a second form.
 *
 * Stays open on failure so nothing typed is lost on a retry; closes and
 * resets (by unmounting) only after a successful submit — see
 * `MissedHoursSheet` for why.
 */

import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { SCHEDULED_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Body, Small } from '@/src/components/ui/typography';
import {
  getWeekDates,
  getWeekStartISO,
} from '@/src/domains/timesheet/utils/week';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { MissedHoursSheet } from './MissedHoursSheet';

/** "Was this shift on her schedule and did she log nothing against it" — a
 * day she worked on an unanswered ask is still a day of missing hours. */
const SCHEDULED_STATUS_SET = new Set<string>(SCHEDULED_SHIFT_STATUSES);

/** The days SHE has a live entry on. A voided entry is not a logged day. */
function loggedDates(
  entries: readonly TimeEntry[],
  currentUserId: string
): Set<string> {
  return new Set(
    entries
      .filter(
        entry => entry.carer_id === currentUserId && entry.status !== 'voided'
      )
      .map(entry => entry.local_date)
  );
}

/**
 * Any day in `[fromISO..toISO]` (both inclusive) she logged nothing on. The
 * arrangement-first-run half of the gate: with no pattern built there are no
 * shifts to detect a missed day from, so backdated terms are the only signal
 * that days worked under the clock-in block exist at all.
 */
function hasUnloggedDayInRange(
  entries: readonly TimeEntry[],
  currentUserId: string,
  fromISO: string,
  toISO: string
): boolean {
  const entryDates = loggedDates(entries, currentUserId);
  for (let day = fromISO; day <= toISO; day = addLocalDays(day, 1)) {
    if (!entryDates.has(day)) return true;
  }
  return false;
}

function hasMissedHoursDay(
  shifts: readonly Shift[],
  entries: readonly TimeEntry[],
  currentUserId: string,
  weekDates: readonly string[]
): boolean {
  const entryDates = loggedDates(entries, currentUserId);
  return shifts.some(
    shift =>
      SCHEDULED_STATUS_SET.has(shift.status) &&
      shift.carer_id === currentUserId &&
      weekDates.includes(shift.local_date) &&
      !entryDates.has(shift.local_date)
  );
}

interface AddMissedHoursCardProps {
  householdId: string;
  /** Household IANA zone — never the device's (GOLDEN-FIXES #21 bug class). */
  timeZone: string;
  /** Household `week_starts_on` (0=Sunday..6=Saturday) — which days count as
   * "this week" for a missed-hours prompt is the household's business week,
   * not a hardcoded Monday. */
  weekStartsOn: number;
  /**
   * A1's recovery path, once. The clock-in block has no escape hatch, so the
   * realistic worst case is that she worked anyway — `ClockInBlockedCard`'s
   * footnote warned her before it happened and named this route afterwards.
   * `ThisWeekCard` asks for the headline in the first week after an
   * arrangement is created, which is the only window where "the rate you just
   * agreed" is true. It never changes what the CTA does.
   */
  firstRunHeadline?: boolean;
  /**
   * Her current arrangement's `valid_from` (household-local `yyyy-mm-dd`),
   * handed down from `ThisWeekCard`'s existing `useCurrentPayArrangement`
   * read — the same query, not a second one.
   *
   * Terms agreed with a backdated start mean she worked days the clock-in
   * block refused. In the account that hits that block hardest there is no
   * pattern and so no shift to notice them from, which is exactly why the
   * shift-derived gate above cannot be the only one.
   */
  arrangementValidFrom?: string | null;
}

export function AddMissedHoursCard({
  householdId,
  timeZone,
  weekStartsOn,
  firstRunHeadline = false,
  arrangementValidFrom = null,
}: AddMissedHoursCardProps) {
  const { t } = useTranslation('today');
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone, weekStartsOn),
    [timeZone, weekStartsOn]
  );
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEndExclusive = useMemo(
    () => addLocalDays(weekDates[weekDates.length - 1] ?? weekStart, 1),
    [weekDates, weekStart]
  );
  const from = useMemo(
    () => wallClockToUtcIso(weekStart, '00:00', timeZone),
    [weekStart, timeZone]
  );
  const to = useMemo(
    () => wallClockToUtcIso(weekEndExclusive, '00:00', timeZone),
    [weekEndExclusive, timeZone]
  );
  const entriesQuery = useWeekTimeEntries(householdId, weekStart);
  const shiftsQuery = useShiftsRange(householdId, from, to);

  const todayISO = useMemo(() => localDateInZone(timeZone), [timeZone]);
  const prevWeekStart = useMemo(() => addLocalDays(weekStart, -7), [weekStart]);
  // ponytail: the first-run window is bounded to this business week and the
  // previous one — the two weeks we hold entries for. Terms backdated further
  // than that have stopped being a fresh start and belong in Hours, which
  // shows any week. Widen by querying more weeks if that ceiling bites.
  const firstRunFrom =
    arrangementValidFrom &&
    arrangementValidFrom >= prevWeekStart &&
    arrangementValidFrom < todayISO
      ? arrangementValidFrom
      : null;
  // Only fetched when the range actually reaches back — `null` disables the
  // query, so a nanny whose terms started this week pays for one read, not two.
  const needsPrevWeek = firstRunFrom !== null && firstRunFrom < weekStart;
  const prevEntriesQuery = useWeekTimeEntries(
    householdId,
    needsPrevWeek ? prevWeekStart : null
  );

  const showCta = useMemo(() => {
    if (!currentUserId) return false;
    if (
      entriesQuery.isLoading ||
      entriesQuery.isPending ||
      shiftsQuery.isLoading ||
      shiftsQuery.isPending
    ) {
      return false;
    }
    const entries = entriesQuery.data ?? [];
    if (
      hasMissedHoursDay(
        shiftsQuery.data ?? [],
        entries,
        currentUserId,
        weekDates
      )
    ) {
      return true;
    }
    if (!firstRunFrom) return false;
    if (
      needsPrevWeek &&
      (prevEntriesQuery.isLoading || prevEntriesQuery.isPending)
    ) {
      return false;
    }
    return hasUnloggedDayInRange(
      needsPrevWeek ? [...(prevEntriesQuery.data ?? []), ...entries] : entries,
      currentUserId,
      firstRunFrom,
      todayISO
    );
  }, [
    currentUserId,
    entriesQuery.data,
    entriesQuery.isLoading,
    entriesQuery.isPending,
    firstRunFrom,
    needsPrevWeek,
    prevEntriesQuery.data,
    prevEntriesQuery.isLoading,
    prevEntriesQuery.isPending,
    shiftsQuery.data,
    shiftsQuery.isLoading,
    shiftsQuery.isPending,
    todayISO,
    weekDates,
  ]);

  const [visible, setVisible] = useState(false);

  if (!showCta) {
    return null;
  }

  return (
    <Fragment>
      {/* Above the CTA, and only in the window `ThisWeekCard` opens: it
          answers "why now" (the rate she just agreed) in the one place the
          answer is true. */}
      {firstRunHeadline ? (
        <Body
          testID="today-missed-hours-headline"
          className="text-muted-foreground"
        >
          {t('missedHours.afterTermsHeadline')}
        </Body>
      ) : null}
      {/* A recovery affordance, not a peer of "Clock in" — left-aligned
          and Small so it reads as a link, not a centred section heading,
          and pulled tight (-mt-2) under the clock card above it rather
          than orphaned in the gap between the two. */}
      <Button
        testID="today-missed-hours-cta"
        variant="ghost"
        className="-mt-2 self-start px-0"
        onPress={() => setVisible(true)}
      >
        <Small className="text-primary">{t('missedHours.cta')}</Small>
      </Button>
      {visible ? (
        <MissedHoursSheet
          householdId={householdId}
          timeZone={timeZone}
          onDismiss={() => setVisible(false)}
          initialDate={localDateInZone(timeZone)}
          initialStart="09:00"
          initialEnd="17:00"
        />
      ) : null}
    </Fragment>
  );
}
