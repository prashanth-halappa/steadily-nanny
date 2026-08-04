/**
 * The earnings engine — the pure function that turns a week of recorded time
 * into a priced breakdown (Tier 0 Phase 2, `TIER0-PLAN.md`).
 *
 * READ FIRST: `docs/11-MONEY.md` §3 (compute live, freeze at approval) and §7
 * (guaranteed top-up, closure days only), and `docs/TIER0-CX-SPEC.md` §4.2
 * (the breakdown sheet these lines render into).
 *
 * PURITY IS THE POINT. This module has no I/O, no repository imports, no
 * clock, and no randomness: plain data in, a `WeekEarnings` out. That is what
 * lets the case table in
 * `apps/api/tests/unit/domains/pay/services/earningsService.test.ts` be
 * exhaustive instead of representative — money math is exactly the kind of
 * logic where a subtle mistake is expensive and quiet. The service wrapper
 * that fetches these inputs (entries, arrangements, closures, shifts) is a
 * separate slice; `ComputeWeekEarningsInput` is shaped so that wrapper is a
 * fetch-and-map with no arithmetic of its own.
 *
 * @module domains/pay/services/earningsService
 */
import type {
  EarningsLine,
  EarningsLineKind,
  TimeEntryKind,
  WeekEarnings,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  EARNINGS_LINE_KINDS,
  EARNINGS_LINE_ORDER,
  EARNINGS_RESULT_STATUSES,
  TIME_ENTRY_KINDS,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import type { PayArrangement } from '../types';

// =============================================================================
// Input
// =============================================================================

/**
 * One time entry, reduced to the three things pricing needs.
 *
 * `minutes` is the entry's already-computed minutes — `computeWorkedMinutes`
 * in `timesheetCommandService` (clocked span minus break, never negative) for
 * a `worked`/`manual_adjustment` entry, and the agreed paid minutes for a
 * `cancellation_paid` one. The engine deliberately does NOT recompute it from
 * clock instants: the roll-up already owns that arithmetic and duplicating it
 * here would let the timesheet total and the money disagree.
 *
 * `local_date` is the household-local `YYYY-MM-DD` from the 017 trigger. An
 * overnight entry belongs WHOLLY to its clock-in date, so an entry spanning a
 * rate-change midnight prices entirely at the old rate. That is a property of
 * the record, not a rounding choice, and the case table pins it.
 */
export interface EarningsTimeEntryInput {
  kind: TimeEntryKind;
  local_date: string;
  minutes: number;
}

/**
 * A shift the carer had scheduled on a household-closure day.
 *
 * `became_payable` is true when that shift turned into worked time or a paid
 * cancellation — the wrapper knows this because a `time_entry` references the
 * shift. A payable shift is already in `payable_minutes`, so it must NOT also
 * count as lost: that is where "no double pay" is enforced, structurally.
 *
 * `scheduled_minutes` is the frozen figure from `shifts`, not a recomputed
 * span — the same discipline as `time_entries.scheduled_minutes`.
 */
export interface ClosureDayShiftInput {
  local_date: string;
  scheduled_minutes: number;
  became_payable: boolean;
}

/**
 * Everything the engine needs, and nothing it does not.
 *
 * `arrangements` may be passed in ANY order and may contain the carer's whole
 * history; the engine resolves per-date internally with the same rule as
 * `payArrangementRepository.effectiveOn` (greatest `valid_from <= date`, ties
 * broken by `created_at desc`). The wrapper's only obligation is to pass every
 * arrangement that could be effective during the week — in practice, the full
 * `listForCarer` result.
 *
 * `closure_dates` are household-local dates; dates outside the week are
 * ignored rather than trusted. `closure_day_shifts` may likewise contain
 * shifts on non-closure days — only shifts on a closure date are counted, so
 * the wrapper can hand over the week's shifts wholesale.
 *
 * `pto_usage_minutes` is Phase 3's input, wired into `payable_minutes` now so
 * a paid-PTO week already suppresses the top-up (`docs/11-MONEY.md` §7). No
 * `pto` LINE is emitted in Phase 2 — Phase 3 adds it, priced, at which point
 * the minutes counted here start being paid for too.
 */
export interface ComputeWeekEarningsInput {
  /** Monday, household-local (`timesheets.week_start`). */
  week_start: string;
  entries: readonly EarningsTimeEntryInput[];
  arrangements: readonly PayArrangement[];
  closure_dates: readonly string[];
  closure_day_shifts: readonly ClosureDayShiftInput[];
  pto_usage_minutes?: number;
}

// =============================================================================
// Date and money primitives
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const MINUTES_PER_HOUR = 60;

/**
 * Pure calendar arithmetic on `YYYY-MM-DD`, UTC-anchored, never a real
 * instant — the same dependency-free convention as
 * `domains/timesheet/utils/weekStart.ts` (this codebase has no date library).
 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const epoch = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) + days * MS_PER_DAY;
  const dt = new Date(epoch);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * THE rounding rule: half-up, applied exactly ONCE per line, at the final
 * multiplication (`minutes × rate_minor ÷ 60`).
 *
 * Computed in integer arithmetic rather than as a float: `minutes * rate` is
 * an exact integer, and `floor((2n + 60) / 120)` is `floor(n/60 + 0.5)` with
 * no binary-fraction step anywhere. `0.1 + 0.2 !== 0.3` is precisely the class
 * of error integer minor units exist to prevent (`docs/11-MONEY.md` §1), and
 * it would be absurd to reintroduce it in the one function that touches every
 * amount.
 *
 * Half-UP (toward +∞), not half-even: the amounts are small, always positive,
 * and a nanny reading a breakdown should never see a penny quietly vanish.
 * Rounding per LINE and summing the rounded lines — rather than rounding a
 * summed exact total — is what makes the breakdown sheet's total visibly equal
 * the rows above it (`docs/TIER0-CX-SPEC.md` §4.2).
 */
function priceMinutes(minutes: number, rateMinor: number): number {
  const exactNumerator = minutes * rateMinor;
  return Math.floor(
    (exactNumerator * 2 + MINUTES_PER_HOUR) / (MINUTES_PER_HOUR * 2)
  );
}

/** Half-up on a value that is genuinely fractional (the overtime multiplier). */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

// =============================================================================
// Arrangement resolution
// =============================================================================

/**
 * The arrangement in force on `date` — the same rule as
 * `payArrangementRepository.effectiveOn`, re-expressed in memory because the
 * engine is pure and prices many dates from one fetch.
 *
 * Greatest `valid_from <= date`, ties broken by `created_at desc`. The
 * tie-break is not a detail: it is the ONLY correction mechanism for a
 * same-day rate typo under append-only, no-future-dating terms
 * (`docs/11-MONEY.md` §2). If that rule ever changes it must change in both
 * places at once — there is a test here that pins it.
 */
function effectiveOn(
  arrangements: readonly PayArrangement[],
  date: string
): PayArrangement | null {
  let best: PayArrangement | null = null;
  for (const candidate of arrangements) {
    if (candidate.valid_from > date) {
      continue;
    }
    if (best === null || candidate.valid_from > best.valid_from) {
      best = candidate;
      continue;
    }
    if (
      candidate.valid_from === best.valid_from &&
      Date.parse(candidate.created_at) > Date.parse(best.created_at)
    ) {
      best = candidate;
    }
  }
  return best;
}

// =============================================================================
// Line assembly
// =============================================================================

/** One day's worth of minutes at one arrangement, before lines are merged. */
interface Segment {
  date: string;
  minutes: number;
  arrangement: PayArrangement;
}

/**
 * Collapse consecutive segments priced by the SAME arrangement into one line
 * with a date span — the mid-week-split row form of `docs/TIER0-CX-SPEC.md`
 * §4.2 ("12h 00m at £18.50 (to Wed 3 Sep)").
 *
 * Merging on the arrangement id rather than on the rate keeps the line's
 * `arrangement_id` truthful for the frozen snapshot, and keeps two rows with
 * a coincidentally equal rate (a correction row, say) honestly separate.
 * Segments arrive date-ascending, so runs are contiguous by construction.
 */
function toLines(
  segments: readonly Segment[],
  kind: EarningsLineKind,
  multiplier: number | null
): EarningsLine[] {
  const lines: EarningsLine[] = [];
  for (const segment of segments) {
    const rateMinor =
      multiplier === null
        ? segment.arrangement.rate_minor
        : // The overtime rate is rounded to minor units BEFORE pricing, so the
          // rate the sub-line displays ("at £27.75 (1.5×)") is exactly the one
          // that produced the amount. Rounding after would let the row fail to
          // reproduce its own total.
          roundHalfUp(segment.arrangement.rate_minor * multiplier);
    const previous = lines[lines.length - 1];
    if (previous && previous.arrangement_id === segment.arrangement.id) {
      previous.minutes += segment.minutes;
      previous.to_date = segment.date;
      previous.amount_minor = priceMinutes(previous.minutes, rateMinor);
      continue;
    }
    lines.push({
      kind,
      minutes: segment.minutes,
      rate_minor: rateMinor,
      multiplier,
      amount_minor: priceMinutes(segment.minutes, rateMinor),
      from_date: segment.date,
      to_date: segment.date,
      arrangement_id: segment.arrangement.id,
    });
  }
  return lines;
}

function sumByDate(
  entries: readonly EarningsTimeEntryInput[],
  kinds: ReadonlySet<string>
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const entry of entries) {
    if (!kinds.has(entry.kind)) {
      continue;
    }
    byDate.set(
      entry.local_date,
      (byDate.get(entry.local_date) ?? 0) + Math.max(0, entry.minutes)
    );
  }
  return byDate;
}

/**
 * WORKED minutes = `worked` + `manual_adjustment` (TIER0-PLAN.md Phase 2). An
 * adjustment is a clock-span correction of worked time, so it belongs in the
 * same bucket and counts toward overtime. Downward corrections are
 * unrepresentable in v1 — `time_entries_clock_order` requires
 * `clock_out > clock_in`, so no entry can carry negative minutes.
 */
const WORKED_KINDS: ReadonlySet<string> = new Set([
  TIME_ENTRY_KINDS.WORKED,
  TIME_ENTRY_KINDS.MANUAL_ADJUSTMENT,
]);
const CANCELLATION_KINDS: ReadonlySet<string> = new Set([
  TIME_ENTRY_KINDS.CANCELLATION_PAID,
]);

function sortedDates(byDate: ReadonlyMap<string, number>): string[] {
  return [...byDate.keys()].sort();
}

function total(byDate: ReadonlyMap<string, number>): number {
  let sum = 0;
  for (const minutes of byDate.values()) {
    sum += minutes;
  }
  return sum;
}

// =============================================================================
// The engine
// =============================================================================

/**
 * Price one week. Deterministic, total, and side-effect free.
 *
 * Three outcomes, and only ever one of them:
 * - `no_arrangement` — some day the week needs priced has no effective
 *   arrangement. The WHOLE week returns this arm; a half-priced week is a
 *   wrong number, not a partial one, and `£0.00` is indistinguishable from
 *   "correctly computed to nothing" (`docs/11-MONEY.md` §4).
 * - `currency_change` — the week spans arrangements in different currencies.
 *   One currency per week is asserted, never summed across
 *   (`docs/TIER0-CX-SPEC.md` §8).
 * - `ok` — the breakdown, in `EARNINGS_LINE_ORDER`, with a total that is the
 *   exact sum of the rounded lines.
 */
export function computeWeekEarnings(
  input: ComputeWeekEarningsInput
): WeekEarnings {
  const { week_start: weekStart, arrangements } = input;
  const weekEnd = addDays(weekStart, DAYS_PER_WEEK - 1);

  const workedByDate = sumByDate(input.entries, WORKED_KINDS);
  const cancelledByDate = sumByDate(input.entries, CANCELLATION_KINDS);

  // Dates the week must be able to price. Every entry's date needs a rate, and
  // so does the week's LAST DAY: it governs the overtime terms, the guaranteed
  // minutes, and the rate a top-up pays at, so a week with no arrangement on
  // or before it cannot be priced at all — including a zero-hours closure week
  // with no entries whatsoever.
  const requiredDates = [
    ...new Set([...input.entries.map(entry => entry.local_date), weekEnd]),
  ].sort();

  const resolved = new Map<string, PayArrangement>();
  const unpricedDates: string[] = [];
  for (const date of requiredDates) {
    const arrangement = effectiveOn(arrangements, date);
    if (arrangement === null) {
      unpricedDates.push(date);
      continue;
    }
    resolved.set(date, arrangement);
  }

  if (unpricedDates.length > 0) {
    // Checked BEFORE the currency assertion: "we cannot price this week at
    // all" is the more fundamental failure, and the nudge it drives ("set a
    // pay rate") is the action that fixes it.
    return {
      status: EARNINGS_RESULT_STATUSES.NO_ARRANGEMENT,
      week_start: weekStart,
      unpriced_dates: unpricedDates,
    };
  }

  // Distinct currencies in the order the week meets them, so the client can
  // say "GBP → EUR" rather than an arbitrary set.
  const currencies: string[] = [];
  for (const date of requiredDates) {
    const currency = resolved.get(date)?.currency;
    if (currency && !currencies.includes(currency)) {
      currencies.push(currency);
    }
  }
  if (currencies.length > 1) {
    return {
      status: EARNINGS_RESULT_STATUSES.CURRENCY_CHANGE,
      week_start: weekStart,
      currencies,
    };
  }

  // Every required date resolved, so the week's last day did too.
  const lastDayArrangement = resolved.get(weekEnd) as PayArrangement;

  // ---------------------------------------------------------------------
  // Overtime configuration — WHICH arrangement governs a week that spans a
  // change. Decision: the arrangement effective on the week's LAST WORKED
  // DAY. Rationale: a threshold and a multiplier are weekly terms, so they
  // cannot be applied per-day without inventing a rule the arrangement never
  // stated; the week is negotiated, worked, and signed off as ONE unit, and
  // the terms in force when the last of that work happened are the terms the
  // parties were operating under at sign-off. It is also deterministic and
  // cheap to explain in a dispute ("the terms in force on the last day you
  // worked"). Per-entry RATES still vary by date — only the threshold and
  // multiplier come from one place.
  //
  // A week with no worked minutes falls back to the last calendar day, which
  // changes nothing (no worked minutes can exceed any threshold) but keeps
  // the config non-null for the rest of the function.
  // ---------------------------------------------------------------------
  const workedDates = sortedDates(workedByDate).filter(
    date => (workedByDate.get(date) ?? 0) > 0
  );
  const lastWorkedDate = workedDates[workedDates.length - 1];
  const overtimeConfig =
    lastWorkedDate === undefined
      ? lastDayArrangement
      : (resolved.get(lastWorkedDate) as PayArrangement);
  const threshold = overtimeConfig.overtime_threshold_minutes;
  const multiplier = overtimeConfig.overtime_multiplier;

  const regularSegments: Segment[] = [];
  const overtimeSegments: Segment[] = [];
  let cumulativeWorked = 0;
  for (const date of workedDates) {
    const minutes = workedByDate.get(date) ?? 0;
    const arrangement = resolved.get(date) as PayArrangement;
    // Null threshold = no overtime for this arrangement; everything is regular.
    const regularRoom =
      threshold === null
        ? minutes
        : Math.max(0, Math.min(minutes, threshold - cumulativeWorked));
    if (regularRoom > 0) {
      regularSegments.push({ date, minutes: regularRoom, arrangement });
    }
    if (minutes - regularRoom > 0) {
      overtimeSegments.push({
        date,
        minutes: minutes - regularRoom,
        arrangement,
      });
    }
    cumulativeWorked += minutes;
  }

  const cancellationSegments: Segment[] = sortedDates(cancelledByDate)
    .filter(date => (cancelledByDate.get(date) ?? 0) > 0)
    .map(date => ({
      date,
      minutes: cancelledByDate.get(date) ?? 0,
      arrangement: resolved.get(date) as PayArrangement,
    }));

  // ---------------------------------------------------------------------
  // Guaranteed top-up — closure-day shortfalls ONLY (owner ruling
  // 2026-08-04, `docs/11-MONEY.md` §7). Three properties this code must keep:
  //   1. No closure days ⇒ no top-up, whatever the shortfall.
  //   2. A closure day with no materialized shifts contributes nothing — no
  //      schedule, nothing lost; the honest record does not invent hours.
  //   3. A closure-day shift already paid (worked, or paid under the
  //      cancellation window) is in `payable_minutes` and so is NOT lost —
  //      that is the no-double-pay guarantee, enforced structurally rather
  //      than by a later subtraction.
  // The guaranteed minutes and the rate come from the week's LAST DAY
  // arrangement, for the same "the week is one unit" reason as the overtime
  // terms — and because a zero-hours closure week has no other date to ask.
  // ---------------------------------------------------------------------
  const closureDates = new Set(
    input.closure_dates.filter(date => date >= weekStart && date <= weekEnd)
  );
  const lostMinutes = input.closure_day_shifts.reduce(
    (sum, shift) =>
      closureDates.has(shift.local_date) && !shift.became_payable
        ? sum + Math.max(0, shift.scheduled_minutes)
        : sum,
    0
  );

  const workedMinutes = total(workedByDate);
  const ptoUsageMinutes = Math.max(0, input.pto_usage_minutes ?? 0);
  const payableMinutes =
    workedMinutes + total(cancelledByDate) + ptoUsageMinutes;

  const guaranteedMinutes = lastDayArrangement.guaranteed_minutes_per_week;
  const shortfall =
    guaranteedMinutes === null
      ? 0
      : Math.max(0, guaranteedMinutes - payableMinutes);
  const topupMinutes = Math.min(lostMinutes, shortfall);

  const topupLines: EarningsLine[] =
    topupMinutes > 0
      ? [
          {
            kind: EARNINGS_LINE_KINDS.GUARANTEED_TOPUP,
            minutes: topupMinutes,
            rate_minor: lastDayArrangement.rate_minor,
            multiplier: null,
            amount_minor: priceMinutes(
              topupMinutes,
              lastDayArrangement.rate_minor
            ),
            // A top-up is a property of the WEEK, not of any one day: it is
            // the gap between what was guaranteed and what the week paid.
            from_date: weekStart,
            to_date: weekEnd,
            arrangement_id: lastDayArrangement.id,
          },
        ]
      : [];

  // Emitted in `EARNINGS_LINE_ORDER` — the CX spec's fixed render order —
  // with empty kinds omitted. `pto` and `reimbursements` are structurally
  // present and always empty until Phases 3 and 4 fill them.
  const byKind: Record<EarningsLineKind, EarningsLine[]> = {
    [EARNINGS_LINE_KINDS.REGULAR]: toLines(
      regularSegments,
      EARNINGS_LINE_KINDS.REGULAR,
      null
    ),
    [EARNINGS_LINE_KINDS.OVERTIME]: toLines(
      overtimeSegments,
      EARNINGS_LINE_KINDS.OVERTIME,
      multiplier
    ),
    [EARNINGS_LINE_KINDS.CANCELLATION_PAID]: toLines(
      cancellationSegments,
      EARNINGS_LINE_KINDS.CANCELLATION_PAID,
      null
    ),
    [EARNINGS_LINE_KINDS.PTO]: [],
    [EARNINGS_LINE_KINDS.GUARANTEED_TOPUP]: topupLines,
    [EARNINGS_LINE_KINDS.REIMBURSEMENTS]: [],
  };
  const lines = EARNINGS_LINE_ORDER.flatMap(kind => byKind[kind]);

  // Gross is the sum of the ROUNDED lines, so the breakdown always adds up on
  // screen. Reimbursements are summed apart and never enter gross — wages and
  // repaid money are different categories (`docs/11-MONEY.md` §6).
  let grossMinor = 0;
  let reimbursementsMinor = 0;
  for (const line of lines) {
    if (line.kind === EARNINGS_LINE_KINDS.REIMBURSEMENTS) {
      reimbursementsMinor += line.amount_minor;
      continue;
    }
    grossMinor += line.amount_minor;
  }

  return {
    status: EARNINGS_RESULT_STATUSES.OK,
    week_start: weekStart,
    currency: lastDayArrangement.currency,
    lines,
    gross_minor: grossMinor,
    reimbursements_minor: reimbursementsMinor,
    worked_minutes: workedMinutes,
    payable_minutes: payableMinutes,
    guaranteed_minutes_per_week: guaranteedMinutes,
  };
}
