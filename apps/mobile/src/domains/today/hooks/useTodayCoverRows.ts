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

export function useTodayCoverRows(
  householdId: string,
  timeZone: string
): { rows: CoverRow[]; isLoading: boolean } {
  const { t } = useTranslation('today');
  const membersQuery = useHouseholdMembers(householdId);
  const weekStart = useMemo(
    () => getWeekStartISO(new Date(), timeZone),
    [timeZone]
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

    for (const [key, bucket] of buckets) {
      const first = bucket[0];
      if (!first) continue;
      if (first.carer_id) covered.add(first.carer_id);
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
      if (shift.local_date !== today || shift.status === 'cancelled') continue;
      if (shift.carer_id && covered.has(shift.carer_id)) continue;
      const key = `shift-${shift.carer_id ?? 'unassigned'}`;
      const bucket = shiftBuckets.get(key);
      if (bucket) {
        bucket.push(shift);
      } else {
        shiftBuckets.set(key, [shift]);
      }
    }

    for (const [key, bucket] of shiftBuckets) {
      const next = [...bucket].sort((a, b) =>
        a.starts_at.localeCompare(b.starts_at)
      )[0];
      if (!next) continue;
      const name = nameFor(next.carer_id);
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
  }, [entries.data, shifts.data, membersByUserId, today, timeZone, t]);

  return {
    rows,
    isLoading: entries.isLoading || shifts.isLoading || membersQuery.isLoading,
  };
}
