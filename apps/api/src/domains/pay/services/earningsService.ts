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
 * One day's paid-time-off usage, dated like a worked entry so PTO prices at
 * the arrangement effective on THAT day — the same rule as `time_entries`
 * (`docs/11-MONEY.md` §5/§7), and the reason this replaces the old undated
 * `pto_usage_minutes` count (see `ComputeWeekEarningsInput`'s doc below).
 * Minutes are clamped at 0, the same defensive convention `sumByDate`
 * already applies to time entries.
 */
export interface PtoUsageInput {
  local_date: string;
  minutes: number;
}

/**
 * One APPROVED expense or mileage claim, already priced. `amount_minor` is
 * the figure frozen at approval — a mileage row freezes `miles ×
 * mileage_rate_per_mile_minor` at that moment (044's approval write); the
 * earnings engine never prices miles itself, it only reads what was already
 * frozen. `currency` travels with each item so the engine can catch a
 * mismatch against the week's resolved currency (see
 * `ComputeWeekEarningsInput`'s doc) instead of silently summing across
 * currencies.
 */
export interface ApprovedExpenseInput {
  local_date: string;
  amount_minor: number;
  currency: string;
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
 * **`pto_usage`** (Phase 3, `docs/11-MONEY.md` §5/§7): dated, one entry per
 * day of paid time off, priced exactly like a worked entry — the arrangement
 * effective on THAT day, never a single week-wide rate. This is the fix for
 * a hazard the old undated `pto_usage_minutes` count could not avoid: a bare
 * minute total has no date to resolve a rate against, so it could only ever
 * be priced at one rate for the whole week — silently wrong for a week that
 * spans a rate change, which is exactly the case a dated `time_entries`
 * input already handles correctly. Each day's minutes ALSO fold into
 * `payable_minutes` (the guaranteed-hours comparison, unchanged from Phase
 * 2), so a paid-PTO week both pays for the PTO on its own `pto` line AND
 * correctly suppresses a top-up for the same minutes — no double pay, and
 * critically, no more "suppresses the top-up and pays nothing at all,"
 * which is what happened before this line existed and why
 * `weekEarningsService.buildWeekEarningsInput` used to hard-zero the input
 * rather than wire the ledger through.
 *
 * **`pto_usage_minutes`** is a DEPRECATED fallback with ZERO production
 * callers as of the Phase 3 wiring — `buildWeekEarningsInput` now passes
 * dated `pto_usage` rows (converting the ledger's stored-negative usage
 * minutes to positive) and no longer sets this field at all. It survives
 * only so an out-of-tree caller cannot break on removal; deleting it is a
 * safe follow-up. When `pto_usage` is
 * omitted entirely, a non-zero `pto_usage_minutes` prices as ONE line
 * spanning the whole week at the arrangement effective on the week's LAST
 * DAY — the same "the week is one unit" convention the top-up and the
 * overtime terms already use, because a flat count has no other date to
 * price against and that is precisely the imprecision the dated field
 * exists to fix. `pto_usage` wins whenever it is provided at all, EVEN AS
 * AN EMPTY ARRAY (a caller stating "no PTO this week" in the dated form is
 * different from "I only have the undated count"). New callers should pass
 * `pto_usage` and leave this field unset; it is a compatibility shim for a
 * caller that has not migrated, not a second correct way to price PTO.
 *
 * **`reimbursements`** (Phase 4, `docs/11-MONEY.md` §6): the week's
 * APPROVED expenses. These are NOT wages: excluded from `gross_minor`, from
 * `payable_minutes`, and from the overtime threshold entirely — they never
 * touch a `regular`/`overtime`/`cancellation_paid`/`guaranteed_topup`/`pto`
 * line, and sum into `reimbursements_minor` instead of `gross_minor`. An
 * expense dated outside `[week_start, week_start+6]` is ignored rather than
 * trusted, the same convention `closure_dates` already uses.
 *
 * Currency: an approved expense whose currency differs from the week's
 * resolved currency is NOT silently summed. Rather than invent a second,
 * quieter "exclude and flag" failure mode, the engine reuses the existing
 * `currency_change` result arm: a mismatched expense currency and a
 * mismatched arrangement currency are the same underlying problem ("this
 * week cannot be honestly expressed in one currency"), so both get the
 * same loud, whole-week answer — no numbers at all, never a partial total
 * with the mismatched item quietly dropped.
 */
export interface ComputeWeekEarningsInput {
  /** Monday, household-local (`timesheets.week_start`). */
  week_start: string;
  entries: readonly EarningsTimeEntryInput[];
  arrangements: readonly PayArrangement[];
  closure_dates: readonly string[];
  closure_day_shifts: readonly ClosureDayShiftInput[];
  /** Dated PTO usage — preferred. See the doc above. */
  pto_usage?: readonly PtoUsageInput[];
  /** @deprecated Undated fallback — see the doc above. Prefer `pto_usage`. */
  pto_usage_minutes?: number;
  /** The week's approved expenses/mileage. See the doc above. */
  reimbursements?: readonly ApprovedExpenseInput[];
}

// =============================================================================
// Date and money primitives
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const MINUTES_PER_HOUR = 60;
/** `overtime_multiplier` is `numeric(3,2)` — ×100 is exactly an integer. */
const PERCENT = 100;

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

/**
 * The overtime hourly rate in minor units: `rate_minor × multiplier`, half-up,
 * and — like `priceMinutes` — computed WITHOUT ever holding a fractional
 * value.
 *
 * `Math.floor(rate_minor * multiplier + 0.5)` was the obvious spelling and it
 * is wrong (Phase 2 review, finding 2). `overtime_multiplier` is a
 * `numeric(3,2)`, and almost no two-decimal value has an exact binary form, so
 * the product lands a hair BELOW its exact decimal value and the `+ 0.5` step
 * then truncates instead of rounding up: `1250 × 1.13` is exactly `1412.5` in
 * decimal but `1412.4999999999998` as a double, so an £12.50/h nanny was
 * priced £14.12 an overtime hour instead of £14.13. Exhaustively over
 * `rate_minor` 1..20000 × `multiplier` 1.00..9.99 that is 16,337 wrong pairs —
 * and every single one rounds LOW. A float error that always favoured the
 * same party is not a rounding choice, it is the bug integer minor units exist
 * to prevent (`docs/11-MONEY.md` §1).
 *
 * In integers instead. `multiplier` is `numeric(3,2)`, so `m = k / 100` for an
 * integer `k` in [100, 999]; `Math.round(multiplier * 100)` recovers that `k`
 * exactly (the representation error is ~1e-13, nowhere near ½). Then
 *
 *   half-up(rate × k / 100) = floor(rate × k / 100 + ½) = floor((rate × k + 50) / 100)
 *
 * where `rate × k + 50` is an exact integer (< 10⁹ for any realistic rate, far
 * inside 2⁵³) and the final division is exact wherever the quotient is a whole
 * number, and otherwise at least 1/100 away from one — thousands of ulps at
 * this magnitude, so `floor` cannot be misled. Verified against exact BigInt
 * arithmetic across the whole domain.
 */
function overtimeRateMinor(rateMinor: number, multiplier: number): number {
  const hundredths = Math.round(multiplier * PERCENT);
  return Math.floor((rateMinor * hundredths + PERCENT / 2) / PERCENT);
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
          overtimeRateMinor(segment.arrangement.rate_minor, multiplier);
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

/**
 * Generic version of `sumByDate` for inputs with no `kind` to filter by —
 * `pto_usage` today. Minutes are clamped at 0, the same defensive
 * convention `sumByDate` applies to time entries.
 */
function sumMinutesByDate(
  items: readonly { local_date: string; minutes: number }[]
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const item of items) {
    byDate.set(
      item.local_date,
      (byDate.get(item.local_date) ?? 0) + Math.max(0, item.minutes)
    );
  }
  return byDate;
}

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

  // `pto_usage` wins over the deprecated `pto_usage_minutes` whenever it is
  // PROVIDED AT ALL, even an empty array — see `ComputeWeekEarningsInput`'s
  // doc. An empty array is a caller stating "no PTO this week" in the dated
  // form, which is different from "I only have the undated count."
  const usingDatedPto = input.pto_usage !== undefined;
  const ptoByDate = usingDatedPto
    ? sumMinutesByDate(input.pto_usage ?? [])
    : new Map<string, number>();

  // Reimbursements dated outside the week are ignored rather than trusted —
  // the same convention `closure_dates` already uses.
  const weekExpenses = (input.reimbursements ?? []).filter(
    expense => expense.local_date >= weekStart && expense.local_date <= weekEnd
  );

  // Dates the week must be able to price. Every entry's date needs a rate, so
  // does every dated PTO usage day (it prices at its own day's rate too), and
  // so does the week's LAST DAY: it governs the overtime terms, the
  // guaranteed minutes, and the rate a top-up (or an undated legacy PTO line)
  // pays at, so a week with no arrangement on or before it cannot be priced
  // at all — including a zero-hours closure week with no entries whatsoever.
  // Reimbursement dates do NOT need to resolve to an arrangement — their
  // amount is already frozen, not priced by this engine.
  const requiredDates = [
    ...new Set([
      ...input.entries.map(entry => entry.local_date),
      ...ptoByDate.keys(),
      weekEnd,
    ]),
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
  // say "GBP → EUR" rather than an arbitrary set. An approved expense in a
  // different currency joins the SAME check — a reimbursement is money too,
  // and "one currency per week, never summed across" applies to it exactly
  // as it applies to a mid-week arrangement currency change
  // (`docs/11-MONEY.md` §6, `ComputeWeekEarningsInput`'s doc).
  const currencies: string[] = [];
  for (const date of requiredDates) {
    const currency = resolved.get(date)?.currency;
    if (currency && !currencies.includes(currency)) {
      currencies.push(currency);
    }
  }
  for (const expense of weekExpenses) {
    if (!currencies.includes(expense.currency)) {
      currencies.push(expense.currency);
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
  // PTO — priced like worked/cancellation_paid segments when dated (Phase 3,
  // `docs/11-MONEY.md` §5/§7): each day's minutes price at the arrangement
  // effective on THAT day, so a week spanning a rate change splits into one
  // line per rate exactly like `regular` does. The deprecated undated
  // fallback has no date to do that with, so it prices as one week-spanning
  // line at the LAST DAY's arrangement instead — see
  // `ComputeWeekEarningsInput`'s doc for why that is the correct trade-off
  // for a caller that has not migrated, not a second correct way to price
  // PTO.
  // ---------------------------------------------------------------------
  const ptoSegments: Segment[] = usingDatedPto
    ? sortedDates(ptoByDate)
        .filter(date => (ptoByDate.get(date) ?? 0) > 0)
        .map(date => ({
          date,
          minutes: ptoByDate.get(date) ?? 0,
          arrangement: resolved.get(date) as PayArrangement,
        }))
    : [];
  const legacyPtoMinutes = usingDatedPto
    ? 0
    : Math.max(0, input.pto_usage_minutes ?? 0);
  const legacyPtoLines: EarningsLine[] =
    legacyPtoMinutes > 0
      ? [
          {
            kind: EARNINGS_LINE_KINDS.PTO,
            minutes: legacyPtoMinutes,
            rate_minor: lastDayArrangement.rate_minor,
            multiplier: null,
            amount_minor: priceMinutes(
              legacyPtoMinutes,
              lastDayArrangement.rate_minor
            ),
            // Like the top-up, a property of the WEEK, not of any one day —
            // the legacy input carries no date to attribute it to.
            from_date: weekStart,
            to_date: weekEnd,
            arrangement_id: lastDayArrangement.id,
          },
        ]
      : [];
  const ptoUsageMinutes = usingDatedPto ? total(ptoByDate) : legacyPtoMinutes;

  // Reimbursements are NOT priced by the engine — mileage was already priced
  // (and a plain expense was always a flat amount) at expense approval,
  // frozen into `amount_minor`. One line per approved item, chronological,
  // so the frozen weekly snapshot stays as self-describing as every other
  // line (`042_timesheet_earnings.sql`'s header comment). `minutes` and
  // `rate_minor` are 0 rather than invented — a reimbursement is not time,
  // and forcing a fictitious duration on it to satisfy the "minutes × rate =
  // amount" shape the other lines share would be a lie the breakdown sheet
  // would then render.
  const reimbursementLines: EarningsLine[] = weekExpenses
    .slice()
    .sort((a, b) => a.local_date.localeCompare(b.local_date))
    .map(expense => ({
      kind: EARNINGS_LINE_KINDS.REIMBURSEMENTS,
      minutes: 0,
      rate_minor: 0,
      multiplier: null,
      amount_minor: expense.amount_minor,
      from_date: expense.local_date,
      to_date: expense.local_date,
      arrangement_id: null,
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
  // with empty kinds omitted. `pto` (priced usage) and `reimbursements`
  // (approved expenses) are populated from Phase 3/4 on; both are still
  // structurally present and empty whenever their input is empty.
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
    [EARNINGS_LINE_KINDS.PTO]: usingDatedPto
      ? toLines(ptoSegments, EARNINGS_LINE_KINDS.PTO, null)
      : legacyPtoLines,
    [EARNINGS_LINE_KINDS.GUARANTEED_TOPUP]: topupLines,
    [EARNINGS_LINE_KINDS.REIMBURSEMENTS]: reimbursementLines,
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
