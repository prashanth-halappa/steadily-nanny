/**
 * Coverage-gap detector — flow 1g ("Per-child coverage & gaps"). A child's
 * covered time comes from a shift's `shift_children` window (or the whole
 * shift when that window is unset — see migration 015's header comment); a
 * commitment marked `excluded_from_cover` (preschool, school...) is what
 * "carves the visible gap out of a coverage lane" wherever the two overlap
 * on a given local date — see `child_commitments`' header comment in
 * `supabase/migrations/010_children.sql`. `computeGaps` is pure interval
 * arithmetic with no Supabase dependency, so it is directly unit-testable;
 * `raiseGapsOnce` is the thin impure shell that persists each carved
 * interval as a `shift_events` row (`event_type: 'coverage_gap'`),
 * de-duplicated per (household, local_date, child, commitment, interval) via
 * `ShiftEventRepository.listEventKeysForDate` so re-running detection for
 * the same day never doubles up the day thread.
 *
 * RRULE MATCHING mirrors `../../schedule/services/recurrenceExpander.ts`
 * (WEEKLY + INTERVAL, dependency-free `Intl.DateTimeFormat` zone maths for
 * nominal-local-time -> UTC conversion) but is intentionally NOT shared with
 * it: that expander resolves weekday + time from a pattern's separate `days`
 * array, while a single commitment's RRULE carries its own BYDAY list — a
 * different enough shape that sharing one function would need a wider,
 * murkier interface than duplicating ~30 lines of calendar-date arithmetic.
 * Keeping the schedule and child domains decoupled is deliberate (see
 * `docs/08-CONVENTIONS.md`).
 *
 * @module domains/child/services/coverageGapService
 */
// Import the repository file DIRECTLY — never the shift domain barrel.
// `../../shift` re-exports services that import from `../../child`, which
// would create a TDZ cycle when this module's singleton initialises.
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { notifyHouseholdParents } from '../../notification';
import { ShiftEventRepository } from '../../shift/repositories/shiftEventRepository';

// =============================================================================
// Pure input/output shapes — no DB row, no ORM type.
// =============================================================================

/** One `shift_children` row's shape, as far as gap detection cares. */
export interface GapShiftChildInput {
  childId: string;
  /** null means "the whole shift" (mirrors the null-pairing on the DB column). */
  startsAt: string | null;
  endsAt: string | null;
}

/** One shift's shape, as far as gap detection cares. */
export interface GapShiftInput {
  id: string;
  /** ISO-8601 UTC instant. */
  startsAt: string;
  endsAt: string;
  children: GapShiftChildInput[];
}

/** One `child_commitments` row's shape, as far as gap detection cares. */
export interface GapCommitmentInput {
  id: string;
  childId: string;
  /** iCalendar RRULE. Only `FREQ=WEEKLY` (with optional `INTERVAL`/`BYDAY`) is honoured. */
  rrule: string;
  /** Nominal local wall-clock time, e.g. '09:00' or '09:00:00'. */
  startTime: string;
  endTime: string;
  startsOn: string | null;
  endsOn: string | null;
  exdates: string[];
  excludedFromCover: boolean;
}

/** One carved-out coverage gap for one child on one local date. */
export interface CoverageGap {
  childId: string;
  commitmentId: string;
  /** ISO-8601 UTC instant. */
  startsAt: string;
  endsAt: string;
}

// =============================================================================
// Calendar-date + zoned wall-clock arithmetic — see recurrenceExpander.ts's
// identical technique; duplicated here on purpose (see module header).
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseDateOnly(dateStr: string): CalendarDate {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

function toEpochDay(dateStr: string): number {
  const { y, m, d } = parseDateOnly(dateStr);
  return Date.UTC(y, m - 1, d);
}

/** 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow). */
function weekdayOf(dateStr: string): number {
  return new Date(toEpochDay(dateStr)).getUTCDay();
}

/** Epoch-day of the Monday on/before the given date (RFC 5545 default WKST=MO). */
function mondayOfWeek(epochMillis: number): number {
  const dow = new Date(epochMillis).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0,...,Sun=6
  return epochMillis - daysSinceMonday * MS_PER_DAY;
}

/** Minutes to ADD to a local wall-clock reading in `timeZone` to get UTC, at the instant `utcMillis`. */
function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = (type: string): number =>
    Number(parts.find(p => p.type === type)?.value ?? '0');

  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return (localAsUtc - utcMillis) / 60_000;
}

/**
 * Convert a nominal local wall-clock date+time, in `timeZone`, to the UTC
 * instant it represents. Standard double-conversion technique — see
 * `recurrenceExpander.ts`'s identical function for the full explanation of
 * why a second correction pass is needed at a DST boundary.
 */
function zonedWallTimeToUtcMillis(
  dateStr: string,
  timeStr: string,
  timeZone: string
): number {
  const { y, m, d } = parseDateOnly(dateStr);
  const [hh = 0, mi = 0, ss = 0] = timeStr.split(':').map(Number);

  const guess = Date.UTC(y, m - 1, d, hh, mi, ss);
  const offset1 = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;

  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return utc;
}

// =============================================================================
// Commitment RRULE matching — WEEKLY + optional INTERVAL/BYDAY only.
// =============================================================================

const WEEKDAY_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

interface ParsedCommitmentRRule {
  interval: number;
  byday: Set<number>;
}

function parseCommitmentRRule(rrule: string): ParsedCommitmentRRule {
  const parts = Object.fromEntries(
    rrule
      .split(';')
      .map(pair => pair.split('='))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key.trim().toUpperCase(), value.trim()])
  );

  const freq = parts.FREQ ?? 'WEEKLY';
  if (freq !== 'WEEKLY') {
    throw new Error(
      `Unsupported RRULE FREQ '${freq}' for a child commitment — only WEEKLY is supported`
    );
  }

  const interval = parts.INTERVAL ? Number.parseInt(parts.INTERVAL, 10) : 1;
  if (!Number.isFinite(interval) || interval < 1) {
    throw new Error(`Invalid RRULE INTERVAL '${parts.INTERVAL}'`);
  }

  const byday = new Set<number>();
  if (parts.BYDAY) {
    for (const code of parts.BYDAY.split(',')) {
      const day = WEEKDAY_CODES[code.trim().toUpperCase()];
      if (day === undefined) {
        throw new Error(`Unsupported RRULE BYDAY code '${code}'`);
      }
      byday.add(day);
    }
  }

  return { interval, byday };
}

/**
 * Whether `commitment` produces an occurrence on `localDate`: within its
 * `starts_on`/`ends_on` bounds, not an `exdate`, on a BYDAY weekday (when
 * BYDAY is given), and — if `INTERVAL > 1` — on a week that lands on the
 * interval starting from `starts_on` (the recurrence anchor; `INTERVAL > 1`
 * without a `starts_on` anchor is a data error, not a "match everything"
 * default).
 */
function isCommitmentActiveOn(
  commitment: GapCommitmentInput,
  localDate: string
): boolean {
  if (commitment.exdates.includes(localDate)) {
    return false;
  }
  if (commitment.startsOn && localDate < commitment.startsOn) {
    return false;
  }
  if (commitment.endsOn && localDate > commitment.endsOn) {
    return false;
  }

  const { interval, byday } = parseCommitmentRRule(commitment.rrule);
  if (byday.size > 0 && !byday.has(weekdayOf(localDate))) {
    return false;
  }

  if (interval > 1) {
    if (!commitment.startsOn) {
      throw new Error(
        `Commitment ${commitment.id} has RRULE INTERVAL=${interval} but no starts_on to anchor it`
      );
    }
    const anchorMonday = mondayOfWeek(toEpochDay(commitment.startsOn));
    const targetMonday = mondayOfWeek(toEpochDay(localDate));
    const weekIndex = Math.round(
      (targetMonday - anchorMonday) / (7 * MS_PER_DAY)
    );
    if (((weekIndex % interval) + interval) % interval !== 0) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// Gap computation
// =============================================================================

/**
 * The de-dupe identity of one raised gap. `commitmentId` is part of the key:
 * two DIFFERENT commitments for the same child can carve an identical
 * interval (e.g. an all-morning preschool block and a swimming lesson inside
 * it, both `excluded_from_cover`, clipped to the same covered window), and
 * those are two distinct gaps to surface — keying on child+interval alone
 * would collapse them into one event.
 */
function gapKey(gap: CoverageGap): string {
  return `${gap.childId}|${gap.commitmentId}|${gap.startsAt}|${gap.endsAt}`;
}

/**
 * Merge overlapping/touching gaps that share a (child, commitment) pair —
 * e.g. two adjoining shifts both partly overlapping the same preschool
 * window produce two touching raw intervals that should read as one gap.
 */
function mergeGaps(gaps: CoverageGap[]): CoverageGap[] {
  const byGroup = new Map<string, CoverageGap[]>();
  for (const gap of gaps) {
    const key = `${gap.childId}|${gap.commitmentId}`;
    const list = byGroup.get(key) ?? [];
    list.push(gap);
    byGroup.set(key, list);
  }

  const merged: CoverageGap[] = [];
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    let current: CoverageGap | undefined;
    for (const gap of list) {
      if (!current) {
        current = { ...gap };
        continue;
      }
      if (Date.parse(gap.startsAt) <= Date.parse(current.endsAt)) {
        if (Date.parse(gap.endsAt) > Date.parse(current.endsAt)) {
          current.endsAt = gap.endsAt;
        }
      } else {
        merged.push(current);
        current = { ...gap };
      }
    }
    if (current) {
      merged.push(current);
    }
  }

  merged.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) || a.childId.localeCompare(b.childId)
  );
  return merged;
}

export class CoverageGapService {
  constructor(
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository()
  ) {}

  /**
   * Pure: the intervals `excluded_from_cover` commitments carve out of
   * shift coverage, per child, for one local date. `shifts` should already
   * be the day's shifts (with their `shift_children`) for the household;
   * `commitments` should already be the day's candidate commitments for
   * that household's children — this method does no fetching of its own.
   */
  computeGaps(
    localDate: string,
    timezone: string,
    shifts: readonly GapShiftInput[],
    commitments: readonly GapCommitmentInput[]
  ): CoverageGap[] {
    const activeExcluded = commitments.filter(
      c => c.excludedFromCover && isCommitmentActiveOn(c, localDate)
    );
    if (activeExcluded.length === 0) {
      return [];
    }

    const rawGaps: CoverageGap[] = [];

    for (const shift of shifts) {
      const shiftStart = Date.parse(shift.startsAt);
      const shiftEnd = Date.parse(shift.endsAt);

      for (const child of shift.children) {
        const coveredStart = child.startsAt
          ? Date.parse(child.startsAt)
          : shiftStart;
        const coveredEnd = child.endsAt ? Date.parse(child.endsAt) : shiftEnd;

        for (const commitment of activeExcluded) {
          if (commitment.childId !== child.childId) {
            continue;
          }
          const commitmentStart = zonedWallTimeToUtcMillis(
            localDate,
            commitment.startTime,
            timezone
          );
          const commitmentEnd = zonedWallTimeToUtcMillis(
            localDate,
            commitment.endTime,
            timezone
          );

          const start = Math.max(coveredStart, commitmentStart);
          const end = Math.min(coveredEnd, commitmentEnd);
          if (end > start) {
            rawGaps.push({
              childId: child.childId,
              commitmentId: commitment.id,
              startsAt: new Date(start).toISOString(),
              endsAt: new Date(end).toISOString(),
            });
          }
        }
      }
    }

    return mergeGaps(rawGaps);
  }

  /**
   * Idempotently persists `computeGaps(...)` as `coverage_gap` shift_events
   * for a household/date — skips any (child, commitment, interval) already
   * raised for that date, so re-running detection (a recurring job, or every
   * day-thread read — see `shiftQueryService.listDayThread`) never doubles up
   * the day thread. Returns only the gaps actually inserted.
   */
  async raiseGapsOnce(
    householdId: string,
    localDate: string,
    timezone: string,
    shifts: readonly GapShiftInput[],
    commitments: readonly GapCommitmentInput[]
  ): Promise<CoverageGap[]> {
    const gaps = this.computeGaps(localDate, timezone, shifts, commitments);
    if (gaps.length === 0) {
      return [];
    }

    const existingKeys = await this.eventRepo.listEventKeysForDate(
      householdId,
      localDate,
      'coverage_gap'
    );
    const toInsert = gaps.filter(gap => !existingKeys.has(gapKey(gap)));
    if (toInsert.length === 0) {
      return [];
    }

    await this.eventRepo.insertMany(
      toInsert.map(gap => ({
        household_id: householdId,
        shift_id: null,
        local_date: localDate,
        actor_id: null,
        event_type: 'coverage_gap',
        payload: {
          key: gapKey(gap),
          child_id: gap.childId,
          commitment_id: gap.commitmentId,
          starts_at: gap.startsAt,
          ends_at: gap.endsAt,
        },
      }))
    );

    // One summary push per batch — only for gaps that passed the pre-insert
    // key filter (insertMany does not return which rows were created).
    try {
      notifyHouseholdParents(householdId, {
        title: 'Coverage gap',
        body: 'Someone is not covered on the schedule.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.COVERAGE_GAP_DETECTED,
          householdId,
        },
      });
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw.
    }

    return toInsert;
  }
}

// Singleton for callers (e.g. a scheduled job) that don't need DI.
export const coverageGapService = new CoverageGapService();
