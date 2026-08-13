/**
 * @module domains/pay/services/nothingUnusualService
 *
 * D-5 / `docs/design/screens-pay-terms.md` §11.1.1's "nothing unusual this
 * week" fast path — the OWNER-DECIDED predicate that refines D-5's literal
 * "same structure as last week" wording (structure moves every week under
 * daily overtime, so a byte-identical-structure test would almost never
 * fire for the household it was written for). "Nothing unusual" is true
 * only when EVERY one of these holds:
 *
 *   1. no time entry this week was edited after the fact,
 *   2. no time entry is ad-hoc (no shift) or off the household's usual
 *      pattern (a shift exists but was not pattern-generated),
 *   3. no open query on the week,
 *   4. no expense or reimbursement attached,
 *   5. no arrangement change took effect inside the week,
 *   6. the week's gross sits within a small band of the trailing four-week
 *      median.
 *
 * `nothingUnusualForWeek` is the PURE predicate — plain booleans/numbers in,
 * a boolean out, exhaustively case-tabled below, same split as
 * `earningsService`/`weekEarningsService`. `NothingUnusualService` is the
 * impure wrapper that fetches what the predicate needs; nothing here prices
 * anything — `weekEarnings` (already computed by the caller) supplies every
 * money fact this module needs, so nothing is computed twice.
 *
 * A fast path that is occasionally WRONG is worse than no fast path at all
 * (the spec's own words) — every criterion below is a reason to say NO, and
 * the predicate never guesses when data is missing.
 */
import type {
  TimeEntry,
  TimesheetStatus,
  WeekEarningsOk,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { TIME_ENTRY_STATUSES } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { ShiftRepository } from '../../shift/repositories/shiftRepository';
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { TimesheetRepository } from '../../timesheet/repositories/timesheetRepository';
import { weekEndExclusive } from '../../timesheet/utils/weekStart';

/** How many trailing approved weeks the median baseline is drawn from. */
const TRAILING_WEEKS = 4;

/**
 * ponytail: a fixed 20% band around the trailing median, not a
 * statistically-derived one (a real anomaly detector wants a household's own
 * variance, which needs more history than four weeks gives). Upgrade path:
 * replace with a variance-aware band once real multi-month household data
 * exists to tune it against.
 */
const MEDIAN_BAND_FRACTION = 0.2;

/**
 * A minute of slack separates "the write that finished the row" from
 * "someone came back and changed this" — same constant and same reasoning as
 * the mobile-side `wasEntryEdited` (`apps/mobile/src/domains/timesheet/
 * utils/entryEdited.ts`), ported here because the server has no dependency
 * path into the mobile app. Keep the two in sync by hand if either changes.
 */
const EDIT_DETECTION_SLACK_MS = 60_000;

export interface NothingUnusualInput {
  timesheetStatus: TimesheetStatus;
  hasEditedEntry: boolean;
  hasAdHocOrOffPatternEntry: boolean;
  reimbursementsMinor: number;
  lineArrangementIds: readonly (string | null)[];
  grossMinor: number;
  /** Most recent first or any order — only the values matter. */
  trailingGrossHistory: readonly number[];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/**
 * Fewer than `TRAILING_WEEKS` prior approved weeks means there is no median
 * baseline — return false so the approve dialog stays silent rather than
 * claiming "nothing unusual" on the screen where money is committed. A fast
 * path that is occasionally wrong is worse than no fast path (this module's
 * own stated principle).
 */
function isWithinMedianBand(
  grossMinor: number,
  history: readonly number[]
): boolean {
  if (history.length < TRAILING_WEEKS) return false;
  const m = median(history);
  if (m === 0) return grossMinor === 0;
  return Math.abs(grossMinor - m) <= m * MEDIAN_BAND_FRACTION;
}

function hasArrangementSplit(ids: readonly (string | null)[]): boolean {
  const distinct = new Set(ids.filter((id): id is string => id !== null));
  return distinct.size > 1;
}

/** The pure predicate — see module header for the full criterion list. */
export function nothingUnusualForWeek(input: NothingUnusualInput): boolean {
  if (input.timesheetStatus === 'queried') return false;
  if (input.hasEditedEntry) return false;
  if (input.hasAdHocOrOffPatternEntry) return false;
  if (input.reimbursementsMinor > 0) return false;
  if (hasArrangementSplit(input.lineArrangementIds)) return false;
  if (!isWithinMedianBand(input.grossMinor, input.trailingGrossHistory)) {
    return false;
  }
  return true;
}

/**
 * Does `entry.clock_out_at` land exactly at local midnight in the entry's
 * OWN frozen `timezone`? A week-boundary split fragment's `updated_at` is
 * legitimately hours later than its rewritten `clock_out_at`, and that is
 * not a correction — same exception mobile's `endsAtLocalMidnight` carves
 * out, ported for the same reason as the slack constant above.
 */
function endsAtLocalMidnight(entry: TimeEntry): boolean {
  if (!entry.clock_out_at) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: entry.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(entry.clock_out_at));
    const hour = parts.find(part => part.type === 'hour')?.value;
    const minute = parts.find(part => part.type === 'minute')?.value;
    return hour === '00' && minute === '00';
  } catch {
    return false;
  }
}

/**
 * Was this entry changed after it was clocked out? A server-side port of
 * `apps/mobile/src/domains/timesheet/utils/entryEdited.ts`'s
 * `wasEntryEdited` — see that module for the full reasoning behind the
 * slack window and the settle-at-latest-timestamp rule.
 */
export function wasTimeEntryEdited(entry: TimeEntry): boolean {
  if (entry.status === TIME_ENTRY_STATUSES.VOIDED) return false;
  if (!entry.clock_out_at) return false;
  if (endsAtLocalMidnight(entry)) return false;
  const clockOutMs = Date.parse(entry.clock_out_at);
  const createdMs = Date.parse(entry.created_at);
  const updatedMs = Date.parse(entry.updated_at);
  if (!Number.isFinite(clockOutMs) || !Number.isFinite(updatedMs)) {
    return false;
  }
  const settledMs = Number.isFinite(createdMs)
    ? Math.max(clockOutMs, createdMs)
    : clockOutMs;
  return updatedMs > settledMs + EDIT_DETECTION_SLACK_MS;
}

/** Narrow interface, same pattern as `WeekEarningsComputer` — the dependency
 * a caller injects stays a single method, not the whole class. */
export interface NothingUnusualComputer {
  computeForWeek: (
    householdId: string,
    carerId: string,
    weekStart: string,
    timesheetStatus: TimesheetStatus,
    weekEarnings: WeekEarningsOk
  ) => Promise<boolean>;
}

export class NothingUnusualService implements NothingUnusualComputer {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository()
  ) {}

  /**
   * `weekEarnings` is the SAME `ok`-status result the caller already
   * computed for the week's earnings line — never recomputed here.
   */
  async computeForWeek(
    householdId: string,
    carerId: string,
    weekStart: string,
    timesheetStatus: TimesheetStatus,
    weekEarnings: WeekEarningsOk
  ): Promise<boolean> {
    const entries = await this.timeEntryRepo.listForCarerWeek(
      householdId,
      carerId,
      weekStart,
      weekEndExclusive(weekStart)
    );
    const priced = entries.filter(
      entry => entry.status !== TIME_ENTRY_STATUSES.VOIDED
    );
    const hasEditedEntry = priced.some(wasTimeEntryEdited);
    const hasAdHocEntry = priced.some(entry => entry.shift_id === null);

    const shiftIds = [
      ...new Set(
        priced
          .map(entry => entry.shift_id)
          .filter((id): id is string => id !== null)
      ),
    ];
    const shifts =
      shiftIds.length > 0 ? await this.shiftRepo.findByIds(shiftIds) : [];
    const hasOffPatternShift = shifts.some(
      shift => shift.source_pattern_id === null
    );

    const trailingGrossHistory = await this.timesheetRepo.recentApprovedGross(
      householdId,
      carerId,
      weekStart,
      TRAILING_WEEKS
    );

    return nothingUnusualForWeek({
      timesheetStatus,
      hasEditedEntry,
      hasAdHocOrOffPatternEntry: hasAdHocEntry || hasOffPatternShift,
      reimbursementsMinor: weekEarnings.reimbursements_minor,
      lineArrangementIds: weekEarnings.lines.map(line => line.arrangement_id),
      grossMinor: weekEarnings.gross_minor,
      trailingGrossHistory,
    });
  }
}

/** Singleton for services that don't need DI. */
export const nothingUnusualService = new NothingUnusualService();
