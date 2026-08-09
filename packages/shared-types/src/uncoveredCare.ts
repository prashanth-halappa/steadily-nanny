/**
 * Uncovered-care detector — the inverse of coverage-gap detection.
 *
 * A family's declared **need** windows (child commitments that define when care
 * is required) are compared against what actually covers each child on a given
 * local date: confirmed/pending/completed shifts (with per-child `shift_children`
 * narrowing when present) and household **closures** (days the family declared
 * no cover is needed). Whatever part of a need window remains after subtracting
 * the union of those covered intervals is **uncovered care**.
 *
 * This module is the **pure** half of the feature — interval arithmetic only,
 * no Supabase, no push notifications. The impure persist/push shell lives in
 * the API's `uncoveredCareService`. Both the API and the mobile app import
 * `computeUncovered` from here so the push notification and the on-screen
 * banner can never disagree on what is uncovered.
 *
 * **Covering shifts:** only statuses in `COVERING_SHIFT_STATUSES` (`pending`,
 * `confirmed`, `completed`) count as cover; `draft`, `declined`, and `cancelled`
 * shifts are ignored.
 *
 * **Empty `children` on a shift:** an empty array means the shift covers **all**
 * children for its whole `[startsAt, endsAt)` span. A non-empty array that lacks
 * an entry for a given child contributes nothing for that child.
 *
 * **Closures:** every closure interval is treated as covered for every child —
 * a closure day means the family declared no cover needed, so nothing inside it
 * can be uncovered.
 *
 * Calendar/zone/RRULE maths mirror `coverageGapService.ts` (WEEKLY + INTERVAL/BYDAY,
 * dependency-free `Intl.DateTimeFormat` zone conversion) but are intentionally
 * duplicated here to keep shared-types free of API imports.
 *
 * @module packages/shared-types/src/uncoveredCare
 */

// =============================================================================
// Public input/output shapes
// =============================================================================

export interface NeedWindowInput {
  id: string;
  childId: string;
  /** iCalendar RRULE. Only FREQ=WEEKLY (with optional INTERVAL/BYDAY) is honoured. */
  rrule: string;
  /** Nominal local wall-clock, e.g. '09:00' or '09:00:00'. */
  startTime: string;
  endTime: string;
  startsOn: string | null;
  endsOn: string | null;
  exdates: string[];
}

export interface CoveredShiftChildInput {
  childId: string;
  /** null means "the whole shift" (mirrors the null-pairing on shift_children). */
  startsAt: string | null;
  endsAt: string | null;
}

export interface CoveredShiftInput {
  id: string;
  /** ISO-8601 UTC instants. */
  startsAt: string;
  endsAt: string;
  /** Shift status — only COVERING_SHIFT_STATUSES actually cover. */
  status: string;
  /** EMPTY array means the shift covers ALL children for its whole span. */
  children: CoveredShiftChildInput[];
}

export interface ClosureInput {
  /** ISO-8601 UTC instants spanning the closure. */
  startsAt: string;
  endsAt: string;
}

export interface UncoveredWindow {
  childId: string;
  commitmentId: string;
  /** ISO-8601 UTC instants. */
  startsAt: string;
  endsAt: string;
}

/** Statuses that actually provide cover. */
export const COVERING_SHIFT_STATUSES: readonly string[] = [
  'pending',
  'confirmed',
  'completed',
];

// =============================================================================
// Calendar-date + zoned wall-clock arithmetic — see coverageGapService.ts's
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
 * Whether `need` produces an occurrence on `localDate`: within its
 * `starts_on`/`ends_on` bounds, not an `exdate`, on a BYDAY weekday (when
 * BYDAY is given), and — if `INTERVAL > 1` — on a week that lands on the
 * interval starting from `starts_on` (the recurrence anchor; `INTERVAL > 1`
 * without a `starts_on` anchor is a data error, not a "match everything"
 * default).
 */
function isCommitmentActiveOn(
  need: NeedWindowInput,
  localDate: string
): boolean {
  if (need.exdates.includes(localDate)) {
    return false;
  }
  if (need.startsOn && localDate < need.startsOn) {
    return false;
  }
  if (need.endsOn && localDate > need.endsOn) {
    return false;
  }

  const { interval, byday } = parseCommitmentRRule(need.rrule);
  if (byday.size > 0 && !byday.has(weekdayOf(localDate))) {
    return false;
  }

  if (interval > 1) {
    if (!need.startsOn) {
      throw new Error(
        `Commitment ${need.id} has RRULE INTERVAL=${interval} but no starts_on to anchor it`
      );
    }
    const anchorMonday = mondayOfWeek(toEpochDay(need.startsOn));
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
// Interval union / subtraction
// =============================================================================

interface UtcInterval {
  start: number;
  end: number;
}

function unionIntervals(intervals: UtcInterval[]): UtcInterval[] {
  if (intervals.length === 0) {
    return [];
  }
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: UtcInterval[] = [];
  const first = sorted[0];
  if (first === undefined) {
    return [];
  }
  let current: UtcInterval = { start: first.start, end: first.end };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next === undefined) {
      continue;
    }
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { start: next.start, end: next.end };
    }
  }
  merged.push(current);
  return merged;
}

/** Remainder of `[needStart, needEnd)` after subtracting the union of `covered`. */
function subtractCovered(
  needStart: number,
  needEnd: number,
  covered: UtcInterval[]
): UtcInterval[] {
  if (needEnd <= needStart) {
    return [];
  }
  const merged = unionIntervals(covered);
  const gaps: UtcInterval[] = [];
  let cursor = needStart;
  for (const c of merged) {
    if (c.end <= cursor) {
      continue;
    }
    if (c.start >= needEnd) {
      break;
    }
    const gapEnd = Math.min(c.start, needEnd);
    if (gapEnd > cursor) {
      gaps.push({ start: cursor, end: gapEnd });
    }
    cursor = Math.max(cursor, c.end);
    if (cursor >= needEnd) {
      break;
    }
  }
  if (cursor < needEnd) {
    gaps.push({ start: cursor, end: needEnd });
  }
  return gaps;
}

/**
 * Merge overlapping/touching uncovered slices that share a (child, commitment)
 * pair — e.g. two adjoining uncovered fragments from one need window should
 * read as one interval.
 */
function mergeWindows(windows: UncoveredWindow[]): UncoveredWindow[] {
  const byGroup = new Map<string, UncoveredWindow[]>();
  for (const window of windows) {
    const key = `${window.childId}|${window.commitmentId}`;
    const list = byGroup.get(key) ?? [];
    list.push(window);
    byGroup.set(key, list);
  }

  const merged: UncoveredWindow[] = [];
  for (const list of byGroup.values()) {
    list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    let current: UncoveredWindow | undefined;
    for (const window of list) {
      if (!current) {
        current = { ...window };
        continue;
      }
      if (Date.parse(window.startsAt) <= Date.parse(current.endsAt)) {
        if (Date.parse(window.endsAt) > Date.parse(current.endsAt)) {
          current.endsAt = window.endsAt;
        }
      } else {
        merged.push(current);
        current = { ...window };
      }
    }
    if (current) {
      merged.push(current);
    }
  }

  merged.sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      a.childId.localeCompare(b.childId)
  );
  return merged;
}

// =============================================================================
// Public API
// =============================================================================

/** Stable de-dupe identity: `childId|commitmentId|startsAt|endsAt`. */
export function uncoveredKey(w: UncoveredWindow): string {
  return `${w.childId}|${w.commitmentId}|${w.startsAt}|${w.endsAt}`;
}

const COVERING_STATUS_SET = new Set<string>(COVERING_SHIFT_STATUSES);

export function computeUncovered(args: {
  localDate: string;
  timezone: string;
  needWindows: readonly NeedWindowInput[];
  shifts: readonly CoveredShiftInput[];
  closures: readonly ClosureInput[];
}): UncoveredWindow[] {
  const { localDate, timezone, needWindows, shifts, closures } = args;
  const raw: UncoveredWindow[] = [];

  for (const need of needWindows) {
    if (!isCommitmentActiveOn(need, localDate)) {
      continue;
    }

    const needStart = zonedWallTimeToUtcMillis(
      localDate,
      need.startTime,
      timezone
    );
    const needEnd = zonedWallTimeToUtcMillis(localDate, need.endTime, timezone);
    if (needEnd <= needStart) {
      continue;
    }

    const covered: UtcInterval[] = [];

    for (const closure of closures) {
      covered.push({
        start: Date.parse(closure.startsAt),
        end: Date.parse(closure.endsAt),
      });
    }

    for (const shift of shifts) {
      if (!COVERING_STATUS_SET.has(shift.status)) {
        continue;
      }
      const shiftStart = Date.parse(shift.startsAt);
      const shiftEnd = Date.parse(shift.endsAt);

      if (shift.children.length === 0) {
        covered.push({ start: shiftStart, end: shiftEnd });
      } else {
        for (const child of shift.children) {
          if (child.childId !== need.childId) {
            continue;
          }
          covered.push({
            start: child.startsAt ? Date.parse(child.startsAt) : shiftStart,
            end: child.endsAt ? Date.parse(child.endsAt) : shiftEnd,
          });
        }
      }
    }

    const uncoveredIntervals = subtractCovered(needStart, needEnd, covered);
    for (const interval of uncoveredIntervals) {
      raw.push({
        childId: need.childId,
        commitmentId: need.id,
        startsAt: new Date(interval.start).toISOString(),
        endsAt: new Date(interval.end).toISOString(),
      });
    }
  }

  return mergeWindows(raw);
}
