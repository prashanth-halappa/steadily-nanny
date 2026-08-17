/**
 * @module domains/today/hooks/useTodayCoverRows
 *
 * "Today's cover" row derivation, extracted out of `NannyLiveStatusCard` so
 * a second consumer (the calm-state card) can ask "is there cover today,
 * and by whom" without re-deriving the bucket/sort logic or firing a second
 * set of queries — `useWeekTimeEntries`/`useShiftsRange`/`useHouseholdMembers`
 * are the SAME query keys either caller uses, so React Query serves both
 * from one cache entry rather than doubling network calls.
 *
 * One row per carer, sorted live -> finished -> arriving -> scheduled. See
 * `NannyLiveStatusCard`'s module doc for the full "why" (F-B1-3-sibling,
 * departed-carer name snapshots, voided-entry exclusion).
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { COVERING_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import type { TimeEntry } from '@/src/domains/timesheet/types';
import { carerKeyOf } from '@/src/domains/timesheet/utils/carerKey';
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { sumEntryMinutes } from '@/src/domains/timesheet/utils/entryMinutes';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { queryState } from '@/src/hooks/queries/queryState';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { useWeekTimeEntries } from '@/src/hooks/queries/useWeekTimeEntries';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

export type CoverKind = 'live' | 'finished' | 'arriving' | 'scheduled';

export interface CoverRow {
  /** The carer's bucket key — stable across refetches, so rows don't jump. */
  key: string;
  name: string;
  kind: CoverKind;
  /** The already-translated state line under the name. */
  detail: string;
}

/** Row order: what is happening now, then what happened, then what's coming. */
const KIND_ORDER: Record<CoverKind, number> = {
  live: 0,
  finished: 1,
  arriving: 2,
  scheduled: 3,
};

const ARRIVING_WINDOW_MS = 60 * 60 * 1000;

/** "Does this shift provide cover" — a pending ask must never render as
 * "Priya is covering today"; the gap card owns that window until she says
 * yes (D-22). */
const COVERING_STATUS_SET = new Set<string>(COVERING_SHIFT_STATUSES);

function shiftRowKey(shift: Pick<Shift, 'id' | 'kind' | 'carer_id'>): string {
  if (shift.kind === SHIFT_KINDS.PARENT_COVER) return 'shift-parent_cover';
  // Unlike `time_entries` (058), `shifts` carries no `household_member_id`/
  // `carer_display_name` snapshot, so a departed carer's shift has no
  // identity beyond the row itself once `carer_id` goes NULL. Falling back
  // to `shift.id` (instead of the literal string 'unassigned') keeps two
  // different departed carers' shifts from merging into one "Carer" row.
  return `shift-${shift.carer_id ?? shift.id}`;
}

export function pickCoverShift(
  shifts: Shift[],
  nowMs: number
): Shift | undefined {
  const covering = shifts
    .filter(shift => COVERING_STATUS_SET.has(shift.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (covering.length === 0) return undefined;
  return (
    covering.find(shift => Date.parse(shift.ends_at) > nowMs) ??
    covering[covering.length - 1]
  );
}

export function useTodayCoverRows(
  householdId: string,
  timeZone: string,
  /** The household's `week_starts_on` — the entries query is keyed on the
   * household's own business week, never a hardcoded Monday. */
  weekStartsOn: number
): {
  rows: CoverRow[];
  isLoading: boolean;
  /** Three-state read of the underlying queries — see
   * `src/hooks/queries/queryState.ts`. `isLoading` above is kept for
   * existing callers; a caller that must tell "loading" apart from "the
   * read failed" (never render "Nothing scheduled today" for the latter —
   * docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B) should read this instead. */
  status: 'loading' | 'error' | 'ready';
  retry: () => void;
} {
  const { t } = useTranslation('today');
  const { t: tSchedule } = useTranslation('schedule');
  const membersQuery = useHouseholdMembers(householdId);
  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone, weekStartsOn),
    [timeZone, weekStartsOn]
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

  const membersByUserId = useMemo(
    () =>
      new Map(
        (membersQuery.data ?? []).map(member => [member.user_id, member])
      ),
    [membersQuery.data]
  );

  const rows: CoverRow[] = useMemo(() => {
    const nowMs = Date.now();
    const fallbackName = t('carerFallback');
    /**
     * Override -> profile name -> the row's own `carer_display_name`. That
     * last link is the only name a DEPARTED carer still has: her membership
     * row is gone, so a member lookup would render "Carer" over hours the
     * card has just correctly attributed to her.
     */
    const nameFor = (carerId: string | null, snapshot?: string | null) =>
      resolveCarerName(
        carerId ? membersByUserId.get(carerId) : undefined,
        fallbackName,
        snapshot
      );

    // Bucket by the SAME identity rule the parent's week screen uses
    // (`carerKeyOf`) — a card that merges two carers Hours splits would
    // report one carer's day under the other's name. A running entry counts
    // whatever its local_date says, because "on the clock" is about now.
    // Voided rows are visible on Hours but did not happen — never coverage (069).
    const buckets = new Map<string, TimeEntry[]>();
    for (const entry of entries.data ?? []) {
      if (entry.status === 'voided') continue;
      if (entry.local_date !== today && entry.status !== 'running') continue;
      const key = carerKeyOf(entry);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(entry);
      } else {
        buckets.set(key, [entry]);
      }
    }

    const result: CoverRow[] = [];
    /** Carers already described by their own entries — their shift adds nothing. */
    const covered = new Set<string>();
    /** Shifts an entry already clocked against — the `carer_id` match above
     * goes blind the moment a departed carer's `carer_id` is NULL on both
     * rows, but `shift_id` on the entry survives account deletion untouched
     * (058's module doc). Without this a departed carer's own shift renders
     * a second "Carer · Due …" row next to her name-bearing entry row. */
    const coveredShiftIds = new Set<string>();

    for (const [key, bucket] of buckets) {
      const first = bucket[0];
      if (!first) continue;
      if (first.carer_id) covered.add(first.carer_id);
      for (const entry of bucket) {
        if (entry.shift_id) coveredShiftIds.add(entry.shift_id);
      }
      const name = nameFor(first.carer_id, first.carer_display_name);

      const running = bucket.find(
        entry => entry.status === 'running' && entry.clock_in_at
      );
      if (running?.clock_in_at) {
        result.push({
          key,
          name,
          kind: 'live',
          detail: t('stateLive', {
            time: formatClockTime(running.clock_in_at, timeZone),
          }),
        });
        continue;
      }

      const lastOut = bucket
        .filter(entry => entry.clock_out_at)
        .sort((a, b) =>
          (b.clock_out_at ?? '').localeCompare(a.clock_out_at ?? '')
        )[0];
      if (!lastOut?.clock_out_at) continue;
      result.push({
        key,
        name,
        kind: 'finished',
        detail: t('stateFinished', {
          time: formatClockTime(lastOut.clock_out_at, timeZone),
          // HER entries for today only — never every carer's hours summed
          // under one name (F-B1-3-sibling).
          duration: formatDuration(
            sumEntryMinutes(
              bucket.filter(entry => entry.local_date === today),
              nowMs
            )
          ),
        }),
      });
    }

    // Today's shifts fill in the carers who have not clocked anything yet.
    const shiftBuckets = new Map<string, Shift[]>();
    for (const shift of shifts.data ?? []) {
      if (
        shift.local_date !== today ||
        !COVERING_STATUS_SET.has(shift.status)
      ) {
        continue;
      }
      if (shift.carer_id && covered.has(shift.carer_id)) continue;
      if (coveredShiftIds.has(shift.id)) continue;
      const key = shiftRowKey(shift);
      const bucket = shiftBuckets.get(key);
      if (bucket) {
        bucket.push(shift);
      } else {
        shiftBuckets.set(key, [shift]);
      }
    }

    for (const [key, bucket] of shiftBuckets) {
      const next = pickCoverShift(bucket, nowMs);
      if (!next) continue;
      const name =
        next.kind === SHIFT_KINDS.PARENT_COVER
          ? tSchedule('cover.parentCoveringRow')
          : nameFor(next.carer_id);
      const startMs = new Date(next.starts_at).getTime();
      const arriving = nowMs < startMs && startMs - nowMs <= ARRIVING_WINDOW_MS;
      result.push({
        key,
        name,
        kind: arriving ? 'arriving' : 'scheduled',
        detail: arriving
          ? t('stateArriving', {
              start: formatClockTime(next.starts_at, timeZone),
            })
          : t('stateScheduled', {
              start: formatClockTime(next.starts_at, timeZone),
              end: formatClockTime(next.ends_at, timeZone),
            }),
      });
    }

    return result.sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name)
    );
  }, [
    entries.data,
    shifts.data,
    membersByUserId,
    today,
    timeZone,
    t,
    tSchedule,
  ]);

  const qs = queryState(entries, shifts, membersQuery);

  return {
    rows,
    isLoading: entries.isLoading || shifts.isLoading || membersQuery.isLoading,
    status: qs.status,
    retry: qs.retry,
  };
}
