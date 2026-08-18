/**
 * @module domains/today/hooks/useTodayCoverage
 *
 * > **One card, one hook, one filter.**
 * > 1. The coverage surface renders EXACTLY ONE top-level surface. Two surfaces cannot disagree
 * >    if there is only one surface.
 * > 2. Its HEADLINE is chosen by the need-centric state (`useUncoveredToday`). Shift-centric rows
 * >    may only ever appear as lines BELOW that headline — never as their own headline, never above it.
 * > 3. Every "does this shift count" test is `COVERING_SHIFT_STATUSES`. Never `status !== 'cancelled'`.
 * > 4. No string may be phrased as reassurance unless it was produced by the same computation that
 * >    would have produced a gap.
 *
 * Composition only — `useUncoveredToday` and `useTodayCoverRows` share React Query keys,
 * so this adds zero network requests.
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_KINDS } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { COVERING_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { useMemo } from 'react';
import { localDateToWeekday } from '@/src/domains/schedule/utils/shiftGrouping';
import type { UncoveredWindowDisplay } from '@/src/domains/schedule/utils/uncoveredDisplay';
import { DEFAULT_WEEK_STARTS_ON } from '@/src/domains/timesheet/utils/week';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import {
  type CoverRow,
  pickCoverShift,
  useTodayCoverRows,
} from './useTodayCoverRows';
import { useUncoveredToday } from './useUncoveredToday';

/** "Does this shift provide cover" — under D-22 a pending ask does not, which
 * is what keeps the gap card up for the whole ask lifecycle (§2.4a). */
const COVERING_STATUS_SET = new Set<string>(COVERING_SHIFT_STATUSES);
const ARRIVING_WINDOW_MS = 60 * 60 * 1000;
const ESCALATION_THRESHOLD_MS = 12 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * §5.4 (D-47) — the gap card's self-escalation, as whole hours until the
 * uncovered window starts, or `null` when it should not escalate.
 *
 * Entirely client-side and derived from the clock: no push, no job, no server
 * state. The card already recomputes on focus, so a boolean over `Date.now()`
 * is the whole mechanism.
 *
 * Rounding is DOWN, not to nearest: 9h40m reads "in 9 hours". Overstating the
 * runway is the one error direction that matters on a card whose entire job is
 * to say nobody is booked. The floor at 1 exists because minutes are banned
 * here (§5.4 — this is the only countdown in the product, and it is in whole
 * hours), so the last hour reads "in 1 hour" rather than counting to zero.
 */
export function gapEscalationHours(
  startsAt: string,
  nowMs: number
): number | null {
  const msUntil = Date.parse(startsAt) - nowMs;
  if (
    !Number.isFinite(msUntil) ||
    msUntil <= 0 ||
    msUntil >= ESCALATION_THRESHOLD_MS
  ) {
    return null;
  }
  return Math.max(1, Math.floor(msUntil / MS_PER_HOUR));
}

export type TodayCoverage =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'setup' }
  | { status: 'noNeedToday'; weekday: string }
  | {
      status: 'gap';
      windows: UncoveredWindowDisplay[];
      plan: PlanLine[];
      dayBar: DayBarSegment[];
      localDate: string;
    }
  | {
      status: 'booked';
      plan: PlanLine[];
      dayBar: DayBarSegment[];
      localDate: string;
    };

/** One stretch of today, as who has it. `minutes` is the segment's width. */
export interface DayBarSegment {
  kind: 'nanny' | 'parentCover' | 'gap';
  minutes: number;
  startsAt: string;
}

const minutesBetween = (startsAt: string, endsAt: string): number =>
  (Date.parse(endsAt) - Date.parse(startsAt)) / 60_000;

/**
 * Today, left to right, as who has it — the plan lines' story in one picture.
 * Same `COVERING_SHIFT_STATUSES` filter as everything else on this surface,
 * so a pending ask never paints over the gap that produced it.
 */
// ponytail: overlapping shifts double-count; merge intervals if it ever matters
export function buildDayBar(
  shifts: readonly Shift[],
  windows: readonly UncoveredWindowDisplay[],
  today: string
): DayBarSegment[] {
  const segments: DayBarSegment[] = [];
  for (const shift of shifts) {
    if (shift.local_date !== today || !COVERING_STATUS_SET.has(shift.status)) {
      continue;
    }
    segments.push({
      kind: shift.kind === SHIFT_KINDS.PARENT_COVER ? 'parentCover' : 'nanny',
      minutes: minutesBetween(shift.starts_at, shift.ends_at),
      startsAt: shift.starts_at,
    });
  }
  for (const window of windows) {
    segments.push({
      kind: 'gap',
      minutes: minutesBetween(window.startsAt, window.endsAt),
      startsAt: window.startsAt,
    });
  }
  return segments.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export interface PlanLine {
  key: string;
  name: string;
  kind: 'live' | 'finished' | 'arriving' | 'booked' | 'parentCover';
  confirmation: 'confirmed' | 'waiting' | null;
  detail: string;
  shiftId?: string;
  startsAt?: string;
  endsAt?: string;
  liveSince?: string;
  leftAt?: string;
  durationLabel?: string;
  arrivingMinutes?: number;
}

function shiftRowKey(shift: Pick<Shift, 'kind' | 'carer_id'>): string {
  if (shift.kind === SHIFT_KINDS.PARENT_COVER) return 'shift-parent_cover';
  return `shift-${shift.carer_id ?? 'unassigned'}`;
}

function shiftConfirmation(
  status: string | undefined
): 'confirmed' | 'waiting' | null {
  if (status === 'pending') return 'waiting';
  if (status === 'confirmed' || status === 'completed') return 'confirmed';
  return null;
}

function buildPlanLines(
  rows: CoverRow[],
  shifts: readonly Shift[],
  today: string,
  nowMs: number
): PlanLine[] {
  const buckets = new Map<string, Shift[]>();
  for (const shift of shifts) {
    if (shift.local_date !== today || !COVERING_STATUS_SET.has(shift.status)) {
      continue;
    }
    const key = shiftRowKey(shift);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(shift);
    } else {
      buckets.set(key, [shift]);
    }
  }

  return rows.map(row => {
    const bucket = buckets.get(row.key) ?? [];
    const shift = pickCoverShift(bucket, nowMs);
    const startMs = shift ? new Date(shift.starts_at).getTime() : 0;
    const arriving =
      !!shift &&
      row.kind === 'arriving' &&
      nowMs < startMs &&
      startMs - nowMs <= ARRIVING_WINDOW_MS;

    let kind: PlanLine['kind'];
    if (shift?.kind === SHIFT_KINDS.PARENT_COVER) {
      kind = 'parentCover';
    } else if (row.kind === 'scheduled') {
      kind = 'booked';
    } else {
      kind = row.kind;
    }

    const confirmation =
      row.kind === 'live' || row.kind === 'finished'
        ? null
        : shiftConfirmation(shift?.status);

    return {
      key: row.key,
      name: row.name,
      kind,
      confirmation,
      detail: row.detail,
      shiftId: shift?.id,
      startsAt: shift?.starts_at,
      endsAt: shift?.ends_at,
      arrivingMinutes: arriving
        ? Math.max(1, Math.round((startMs - nowMs) / 60_000))
        : undefined,
    };
  });
}

export function useTodayCoverage(
  householdId: string | null | undefined,
  timeZone: string | null | undefined,
  /** The household's `week_starts_on`, threaded to `useTodayCoverRows`. */
  weekStartsOn: number | null | undefined
): TodayCoverage {
  const uncovered = useUncoveredToday(householdId, timeZone);
  // The placeholders are all reached together, on the branch where there is
  // no household yet — the query below is disabled by the empty id, so the
  // named default never decides a real household's week.
  const coverQuery = useTodayCoverRows(
    householdId ?? '',
    timeZone ?? 'UTC',
    weekStartsOn ?? DEFAULT_WEEK_STARTS_ON
  );

  const localDate = timeZone ? localDateInZone(timeZone) : null;
  const from =
    localDate && timeZone
      ? wallClockToUtcIso(localDate, '00:00', timeZone)
      : '';
  const to =
    localDate && timeZone
      ? wallClockToUtcIso(addLocalDays(localDate, 1), '00:00', timeZone)
      : '';
  const shiftsQuery = useShiftsRange(householdId, from, to);

  const plan = useMemo(() => {
    if (!localDate) return [];
    return buildPlanLines(
      coverQuery.rows,
      shiftsQuery.data ?? [],
      localDate,
      Date.now()
    );
  }, [coverQuery.rows, shiftsQuery.data, localDate]);

  // A failed read is not a slow one: the coverage surface OWNS the parent's
  // pinned slot, so "still loading" here renders as an indefinite blank where
  // the one fact he opened the app for should be.
  const settled = uncovered.status === 'error' ? null : uncovered;

  const state = useMemo((): TodayCoverage => {
    if (
      !householdId ||
      !timeZone ||
      settled === null ||
      settled.status === 'loading' ||
      coverQuery.isLoading ||
      shiftsQuery.isLoading
    ) {
      return { status: 'loading' };
    }
    if (settled.status === 'setup') {
      return { status: 'setup' };
    }
    if (settled.status === 'noNeedToday') {
      return {
        status: 'noNeedToday',
        weekday: String(localDateToWeekday(settled.localDate)),
      };
    }
    const shifts = shiftsQuery.data ?? [];
    if (settled.status === 'uncovered') {
      return {
        status: 'gap',
        windows: settled.windows,
        plan,
        dayBar: buildDayBar(shifts, settled.windows, settled.localDate),
        localDate: settled.localDate,
      };
    }
    return {
      status: 'booked',
      plan,
      dayBar: buildDayBar(shifts, [], settled.localDate),
      localDate: settled.localDate,
    };
  }, [
    householdId,
    timeZone,
    settled,
    coverQuery.isLoading,
    shiftsQuery.isLoading,
    shiftsQuery.data,
    plan,
  ]);

  // After every hook, so the early return is safe. Error wins over loading,
  // and `retry` fans out to whichever sources actually failed.
  if (uncovered.status === 'error' || coverQuery.status === 'error') {
    return {
      status: 'error',
      retry: () => {
        if (uncovered.status === 'error') uncovered.retry();
        if (coverQuery.status === 'error') coverQuery.retry();
      },
    };
  }
  return state;
}
