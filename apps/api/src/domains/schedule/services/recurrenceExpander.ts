/**
 * Recurrence expander — expands a schedule pattern's RRULE + EXDATE +
 * pause_ranges over a horizon into concrete shift occurrences. Pure, with NO
 * Supabase dependency, so it is directly unit-testable (see
 * `tests/unit/domains/schedule/services/recurrenceExpander.test.ts` for the
 * full DST case table this file is held to).
 *
 * DST CORRECTNESS — the load-bearing rule
 * `schedule_pattern_days.start_time` / `end_time` are NOMINAL LOCAL
 * WALL-CLOCK times (supabase/migrations/014_schedule_patterns.sql). Expansion
 * is: the RRULE produces a local calendar date -> combine that date with the
 * wall-clock time -> convert to UTC IN THE PATTERN'S IANA TIMEZONE, FOR THAT
 * SPECIFIC DATE. We never store, or compute from, a pre-resolved UTC offset —
 * the offset is re-derived per occurrence via `Intl.DateTimeFormat`, which is
 * what makes a "Thursdays 8am" pattern survive a GMT/BST transition without
 * drifting. `startsAt` and `endsAt` are converted INDEPENDENTLY of one
 * another (never `startsAt + duration`), which is what keeps a 9-hour
 * wall-clock shift exactly 9 UTC hours even on the day the clocks change.
 *
 * RRULE SUPPORT is intentionally narrow: `FREQ=WEEKLY` with an `INTERVAL`
 * (default 1) is the only recurrence this product needs — "every week" /
 * "every other week" / "term time only" (the last one is `pause_ranges`, not
 * a different FREQ). Which weekdays occur, and their times, come from the
 * pattern's `days` array (one row per `schedule_pattern_days` record) rather
 * than from an RRULE `BYDAY` list — the two are kept in sync by the command
 * service, and `days` is authoritative here.
 *
 * @module domains/schedule/services/recurrenceExpander
 */

/**
 * One `schedule_pattern_day_children` row's shape. `startTime`/`endTime` are
 * both null for "the whole shift", or both a nominal local wall-clock time
 * carving out a sub-range (the DB's `..._time_pairing` check).
 */
export interface PatternDayChildInput {
  childId: string;
  startTime: string | null;
  endTime: string | null;
}

/** One `schedule_pattern_days` row's shape, as far as the expander cares. */
export interface PatternDayInput {
  /** 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow). */
  weekday: number;
  /** Nominal local wall-clock time, e.g. '08:00' or '08:00:00'. */
  startTime: string;
  endTime: string;
  children?: PatternDayChildInput[];
}

/** One child's resolved coverage window for a single occurrence. */
export interface ExpandedOccurrenceChild {
  childId: string;
  /** null means "the whole shift" (mirrors the null-pairing on the input). */
  startsAt: string | null;
  endsAt: string | null;
}

/** One term-time pause — both bounds are calendar dates, inclusive. */
export interface PauseRangeInput {
  from: string;
  to: string;
}

/** The pure input shape the expander needs — no DB row, no ORM types. */
export interface RecurrencePatternInput {
  /** iCalendar RRULE. Only `FREQ=WEEKLY;INTERVAL=n` is honoured. */
  rrule: string;
  /** First date the rule can produce, 'YYYY-MM-DD'. */
  dtstart: string;
  /** Last date, inclusive, or null for "no end date". */
  until: string | null;
  /** One-off skipped dates, 'YYYY-MM-DD'[]. */
  exdates: string[];
  /** Term-time pauses (inclusive ranges). */
  pauseRanges: PauseRangeInput[];
  /** IANA zone the wall-clock times in `days` are expressed in. */
  timezone: string;
  days: PatternDayInput[];
}

/** One materialisable occurrence. */
export interface ExpandedOccurrence {
  /** The calendar date of the occurrence's START, in the pattern's timezone. */
  localDate: string;
  weekday: number;
  /**
   * The WALL-CLOCK time (e.g. '07:00:00') copied VERBATIM from the pattern day.
   * NOT the UTC instant and NOT derived from `startsAt`. The UID built from it is
   * assigned once at shift-creation time and must not read differently on either
   * side of a DST boundary.
   */
  startTime: string;
  /** ISO-8601 UTC instant, e.g. '2026-02-05T08:00:00.000Z'. */
  startsAt: string;
  endsAt: string;
  children: ExpandedOccurrenceChild[];
}

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

/** Pure calendar-date arithmetic — always UTC-anchored midnight, never a real instant. */
function toEpochDay(date: CalendarDate): number {
  return Date.UTC(date.y, date.m - 1, date.d);
}

function fromEpochDay(epochMillis: number): CalendarDate {
  const dt = new Date(epochMillis);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function formatDateOnly(date: CalendarDate): string {
  const mm = String(date.m).padStart(2, '0');
  const dd = String(date.d).padStart(2, '0');
  return `${date.y}-${mm}-${dd}`;
}

/** 0 = Sunday .. 6 = Saturday. */
function weekdayOf(epochMillis: number): number {
  return new Date(epochMillis).getUTCDay();
}

/** Epoch-day of the Monday on/before the given date (RFC 5545 default WKST=MO). */
function mondayOfWeek(epochMillis: number): number {
  const dow = weekdayOf(epochMillis); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0,...,Sun=6
  return epochMillis - daysSinceMonday * MS_PER_DAY;
}

interface ParsedRRule {
  freq: string;
  interval: number;
}

function parseRRule(rrule: string): ParsedRRule {
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
      `Unsupported RRULE FREQ '${freq}' — only WEEKLY is supported (term-time is modelled as pause_ranges, not a different FREQ)`
    );
  }
  const interval = parts.INTERVAL ? Number.parseInt(parts.INTERVAL, 10) : 1;
  if (!Number.isFinite(interval) || interval < 1) {
    throw new Error(`Invalid RRULE INTERVAL '${parts.INTERVAL}'`);
  }
  return { freq, interval };
}

/**
 * Convert a nominal local wall-clock date+time, in `timeZone`, to the UTC
 * instant it represents. Dependency-free (uses only `Intl.DateTimeFormat`,
 * matching the "small, dependency-free" convention of `utils/dateUtils.ts`).
 *
 * Standard double-conversion technique: guess the UTC instant by treating the
 * wall-clock fields as if they were already UTC, measure the zone's offset AT
 * that guess, correct once, then re-measure the offset at the corrected
 * instant and correct again if it changed (the DST-boundary edge case).
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

  // The wall-clock reading in `timeZone` for this UTC instant, reinterpreted
  // as if it were itself a UTC instant.
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

function toIsoString(millis: number): string {
  return new Date(millis).toISOString();
}

function isExcluded(
  dateStr: string,
  exdateSet: ReadonlySet<string>,
  pauseRanges: readonly PauseRangeInput[]
): boolean {
  if (exdateSet.has(dateStr)) {
    return true;
  }
  return pauseRanges.some(
    range => dateStr >= range.from && dateStr <= range.to
  );
}

/**
 * Expand a pattern into concrete occurrences from `pattern.dtstart` up to
 * `min(pattern.until, horizonEnd)`, inclusive.
 */
export function expandRecurrence(
  pattern: RecurrencePatternInput,
  horizonEnd: string
): ExpandedOccurrence[] {
  const { interval } = parseRRule(pattern.rrule);

  const dtstartEpoch = toEpochDay(parseDateOnly(pattern.dtstart));
  const endEpoch = toEpochDay(
    parseDateOnly(
      pattern.until && pattern.until < horizonEnd ? pattern.until : horizonEnd
    )
  );
  const anchorMonday = mondayOfWeek(dtstartEpoch);
  const exdateSet = new Set(pattern.exdates);

  const occurrences: ExpandedOccurrence[] = [];

  for (const day of pattern.days) {
    for (let epoch = dtstartEpoch; epoch <= endEpoch; epoch += MS_PER_DAY) {
      if (weekdayOf(epoch) !== day.weekday) {
        continue;
      }
      const weekIndex = Math.round(
        (mondayOfWeek(epoch) - anchorMonday) / (7 * MS_PER_DAY)
      );
      if (weekIndex % interval !== 0) {
        continue;
      }

      const dateStr = formatDateOnly(fromEpochDay(epoch));
      if (isExcluded(dateStr, exdateSet, pattern.pauseRanges)) {
        continue;
      }

      const startsAtMillis = zonedWallTimeToUtcMillis(
        dateStr,
        day.startTime,
        pattern.timezone
      );
      const endsAtMillis = zonedWallTimeToUtcMillis(
        dateStr,
        day.endTime,
        pattern.timezone
      );

      occurrences.push({
        localDate: dateStr,
        weekday: day.weekday,
        startTime: day.startTime,
        startsAt: toIsoString(startsAtMillis),
        endsAt: toIsoString(endsAtMillis),
        children: (day.children ?? []).map(child => ({
          childId: child.childId,
          startsAt:
            child.startTime === null
              ? null
              : toIsoString(
                  zonedWallTimeToUtcMillis(
                    dateStr,
                    child.startTime,
                    pattern.timezone
                  )
                ),
          endsAt:
            child.endTime === null
              ? null
              : toIsoString(
                  zonedWallTimeToUtcMillis(
                    dateStr,
                    child.endTime,
                    pattern.timezone
                  )
                ),
        })),
      });
    }
  }

  occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return occurrences;
}
