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
 * trusted.
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
  /**
   * The first day of the household's own workweek, household-local
   * (`timesheets.week_start`) — NOT necessarily a Monday. Which day it is
   * comes from `households.week_starts_on` (§5 D-8) and is resolved by the
   * caller; this engine takes it as given and derives the week as
   * `[week_start, week_start + 6]`, so it is week-start agnostic by
   * construction. Pinned by the 'Sunday-start workweek' cases in the test
   * table.
   */
  week_start: string;
  entries: readonly EarningsTimeEntryInput[];
  arrangements: readonly PayArrangement[];
  /** Dated PTO usage — preferred. See the doc above. */
  pto_usage?: readonly PtoUsageInput[];
  /** @deprecated Undated fallback — see the doc above. Prefer `pto_usage`. */
  pto_usage_minutes?: number;
  /** The week's approved expenses/mileage. See the doc above. */
  reimbursements?: readonly ApprovedExpenseInput[];
  /**
   * The household-local DATES in this week the household observes as
   * holidays (3-E4, §5 D-12). Dates, never holiday keys: the engine takes
   * priced FACTS, not storage, the same boundary the PTO netting sits on
   * (see `netPtoUsage`'s doc in `weekEarningsService`). Resolving this
   * household's `household_holidays` toggles into this week's dates — a
   * per-year rule, and one that has to span a New Year week — is the
   * wrapper's job (`observedHolidayDatesInRange`).
   *
   * Omitted and `[]` mean the same thing here, unlike `pto_usage`: no
   * observed holidays. There is no legacy undated form to disambiguate
   * against, and a caller that has not wired holidays through must never
   * accidentally pay a premium.
   *
   * Dates outside `[week_start, week_start+6]` are harmless — the worked
   * premium needs worked minutes on the date, and the unworked credit
   * (3-E5) only ever looks at the seven dates inside the week.
   */
  observed_holidays?: readonly string[];
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
 * Greatest `valid_from <= date` among rows not yet ended (065's `valid_to`),
 * ties broken by `created_at desc`. The
 * tie-break is not a detail: it is the ONLY correction mechanism for a
 * same-day rate typo under append-only, no-future-dating terms
 * (`docs/11-MONEY.md` §2). If that rule ever changes it must change in both
 * places at once — there is a test here that pins it.
 *
 * Exported for the cross-implementation parity test (F-B10-7) — see
 * `apps/api/tests/unit/domains/pay/services/effectiveOnParity.test.ts`, which
 * runs one vector table through BOTH this and the repository's SQL.
 */
export function effectiveOn(
  arrangements: readonly PayArrangement[],
  date: string
): PayArrangement | null {
  let best: PayArrangement | null = null;
  for (const candidate of arrangements) {
    if (candidate.valid_from > date) {
      continue;
    }
    // 065: removal end-dates an arrangement (INCLUSIVE), so it stops being in
    // force the day after. The history this loop reads is deliberately
    // unfiltered — a week worked before the end must still price at the terms
    // of the day — so the exclusion has to be per-date, here, exactly as the
    // repository's `or(valid_to.is.null,valid_to.gte.date)` does it in SQL.
    if (candidate.valid_to !== null && candidate.valid_to < date) {
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
/**
 * The hourly rate a line displays AND prices at — one function, so the two can
 * never disagree.
 *
 * Three shapes:
 * - `multiplier === null` — the base rate (`regular`, `pto`, the top-up).
 * - a multiplier — the already-multiplied rate, rounded to minor units BEFORE
 *   pricing, so the sub-line's "at £27.75 (1.5×)" is exactly the figure that
 *   produced the amount. Rounding after would let the row fail to reproduce
 *   its own total.
 * - `premiumIncrementOnly` — the UPLIFT alone (3-E4's `holiday_premium`): the
 *   multiplied rate minus the base. That subtraction is exact, not an
 *   approximation of `rate × (m − 1)`: with `k = round(m × 100)`,
 *
 *     floor((r·k + 50) / 100) − r = floor((r·k + 50 − 100r) / 100)
 *                                 = floor((r·(k − 100) + 50) / 100)
 *
 *   which is `overtimeRateMinor(r, m − 1)` computed without ever forming
 *   `m − 1` in floating point. So the uplift and the base always sum to the
 *   full premium rate to the penny — asserted by the case table — and the
 *   engine keeps ONE audited rounding helper instead of two.
 */
function lineRateMinor(
  baseRate: number,
  multiplier: number | null,
  premiumIncrementOnly: boolean
): number {
  if (multiplier === null) {
    return baseRate;
  }
  const fullRate = overtimeRateMinor(baseRate, multiplier);
  return premiumIncrementOnly ? fullRate - baseRate : fullRate;
}

function toLines(
  segments: readonly Segment[],
  kind: EarningsLineKind,
  multiplier: number | null,
  premiumIncrementOnly = false
): EarningsLine[] {
  const lines: EarningsLine[] = [];
  for (const segment of segments) {
    const rateMinor = lineRateMinor(
      segment.arrangement.rate_minor,
      multiplier,
      premiumIncrementOnly
    );
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

  // Reimbursements dated outside the week are ignored rather than trusted.
  const weekExpenses = (input.reimbursements ?? []).filter(
    expense => expense.local_date >= weekStart && expense.local_date <= weekEnd
  );

  const weekDates: string[] = [];
  for (let offset = 0; offset < DAYS_PER_WEEK; offset += 1) {
    weekDates.push(addDays(weekStart, offset));
  }

  const workedDates = sortedDates(workedByDate).filter(
    date => (workedByDate.get(date) ?? 0) > 0
  );
  const lastWorkedDate = workedDates[workedDates.length - 1];
  const observedHolidays = new Set(input.observed_holidays ?? []);

  // ---------------------------------------------------------------------
  // WHICH ARRANGEMENT STATES THE WEEK'S TERMS — the week's LAST WORKED DAY,
  // falling back to its last calendar day when nothing was worked. Every
  // threshold and every multiplier below is read off this ONE row; only the
  // per-day RATES vary by date. See the long rationale at `overtimeConfig`.
  //
  // Resolved here, before `requiredDates`, purely because the unworked-holiday
  // credit is one of its terms and the credit ADDS DATES the week must be
  // able to price. Its own date is in `requiredDates` either way (a worked
  // date, or `weekEnd`), so a null here still fails loudly a few lines down.
  // ---------------------------------------------------------------------
  const configDate = lastWorkedDate ?? weekEnd;
  const configArrangement = effectiveOn(arrangements, configDate);

  // ---------------------------------------------------------------------
  // THE UNWORKED-HOLIDAY CREDIT (3-E5, §5 D-53) — which dates earn one.
  //
  // One per date in THIS week that the household observes AND nobody worked.
  // The zero-worked-minutes gate is what makes the credit and 3-E4's premium
  // mutually exclusive by construction: the premium needs worked minutes on
  // the date, this needs none, so a single date can only ever earn one.
  //
  // A credit date is a date the week now has to PRICE, which is why it joins
  // `requiredDates`: a credit the engine silently skipped would report a
  // gross wrong by a whole day. That only bites when a credit term exists —
  // a household with no `holiday_hours_minutes` needs no rate for a day
  // nobody worked, exactly as before 095.
  // ---------------------------------------------------------------------
  const holidayCreditMinutes = configArrangement?.holiday_hours_minutes ?? null;
  const paidHolidayDates =
    holidayCreditMinutes !== null && holidayCreditMinutes > 0
      ? weekDates.filter(
          date =>
            observedHolidays.has(date) && (workedByDate.get(date) ?? 0) === 0
        )
      : [];

  // Dates the week must be able to price. Every entry's date needs a rate, so
  // does every dated PTO usage day (it prices at its own day's rate too), so
  // does every credited holiday (same reason), and so does the week's LAST
  // DAY: it governs the overtime terms, the guaranteed minutes, and the rate
  // a top-up (or an undated legacy PTO line) pays at, so a week with no
  // arrangement on or before it cannot be priced at all — including a
  // zero-hours closure week with no entries whatsoever.
  // Reimbursement dates do NOT need to resolve to an arrangement — their
  // amount is already frozen, not priced by this engine.
  const requiredDates = [
    ...new Set([
      ...input.entries.map(entry => entry.local_date),
      ...ptoByDate.keys(),
      ...paidHolidayDates,
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
  //
  // Resolved up with `configDate`/`configArrangement` above (the credit needs
  // it before `requiredDates` is built) — and non-null by then, because
  // `configDate` is itself one of the required dates that just resolved.
  // ---------------------------------------------------------------------
  const overtimeConfig = configArrangement as PayArrangement;
  const threshold = overtimeConfig.overtime_threshold_minutes;
  const multiplier = overtimeConfig.overtime_multiplier;
  // 078's tiers, read off the SAME arrangement as the weekly pair above. A
  // threshold is a term, not a fact about a day, so all of them come from one
  // place for the same "the week is negotiated and signed off as one unit"
  // reason — and `?? null` because the columns are optional on the wire for
  // pre-078 rows and fixtures (see `payArrangement.schema.ts`).
  const dailyThreshold =
    overtimeConfig.overtime_daily_threshold_minutes ?? null;
  const doubletimeMultiplier = overtimeConfig.doubletime_multiplier ?? null;
  // A double-time THRESHOLD with no multiplier prices nothing: 078 forbids
  // the combination, and inventing a rate for it would be fabricating money.
  // The minutes are not dropped — they simply stay in the tier below.
  const doubletimeThreshold =
    doubletimeMultiplier === null
      ? null
      : (overtimeConfig.doubletime_daily_threshold_minutes ?? null);
  const seventhDayMultiplier = overtimeConfig.seventh_day_multiplier ?? null;
  // Same rule as above for the seventh day's second tier.
  const seventhDayDoubletimeAfter =
    doubletimeMultiplier === null
      ? null
      : (overtimeConfig.seventh_day_doubletime_after_minutes ?? null);

  // ---------------------------------------------------------------------
  // The seventh consecutive day — WHICH day, and whether the rule applies.
  //
  // "The seventh consecutive day of the workweek" is the seventh DATE of
  // THIS household's own week (`week_start + 6`), never "Sunday": 3-E1 made
  // `week_start` the household's chosen first day, so for a Sunday-start
  // family the seventh day is a Saturday. Resolving a weekday name here
  // instead would silently pay the wrong day for every household that is not
  // Monday-start.
  //
  // "Consecutive" means all seven were worked. One missed Wednesday and the
  // Sunday is an ordinary day, priced by the daily tiers like any other —
  // which is why this checks every date in the span rather than counting
  // worked days (seven worked days that include one from the week before is
  // not this week's seventh day).
  // ---------------------------------------------------------------------
  const seventhDayDate = weekDates[DAYS_PER_WEEK - 1] as string;
  const seventhDayApplies =
    seventhDayMultiplier !== null &&
    weekDates.every(date => (workedByDate.get(date) ?? 0) > 0);

  // ---------------------------------------------------------------------
  // Pricing order (`docs/design/screens-pay-terms.md` §10.1, CA Wage Order
  // 15). Three steps, and the order is the whole rule:
  //
  //   1. The seventh day, if it applies, is priced WHOLE at its own tiers and
  //      contributes NOTHING to the weekly threshold.
  //   2. Every other worked day splits into regular / daily overtime / double
  //      time against the DAILY thresholds.
  //   3. Weekly overtime accumulates over the REMAINDER only — the minutes no
  //      daily tier already promoted.
  //
  // §10.1: "Five 10-hour days is 40 regular + 10 overtime, never 40 + 20 —
  // the 10 hours are daily overtime AND they are the hours above 40 in the
  // week; they are the same hours." Weekly overtime never re-examines an
  // hour a daily tier already promoted, and double time is never demoted by
  // a weekly rule. Doing step 3 on total worked minutes instead of on the
  // remainder is exactly the double-count that produces $1,596 where payroll
  // says $1,540.
  // ---------------------------------------------------------------------
  const regularSegments: Segment[] = [];
  const overtimeSegments: Segment[] = [];
  const doubletimeSegments: Segment[] = [];
  /** Day minutes left over after the daily tiers — the weekly rule's input. */
  const remainderByDate = new Map<string, number>();

  for (const date of workedDates) {
    const minutes = workedByDate.get(date) ?? 0;
    const arrangement = resolved.get(date) as PayArrangement;

    if (seventhDayApplies && date === seventhDayDate) {
      // Step 1. Priced whole, at the seventh-day tiers — and deliberately
      // NOT added to `remainderByDate`, so not one of these minutes can be
      // counted a second time by the weekly rule.
      const firstTier =
        seventhDayDoubletimeAfter === null
          ? minutes
          : Math.min(minutes, seventhDayDoubletimeAfter);
      if (firstTier > 0) {
        overtimeSegments.push({ date, minutes: firstTier, arrangement });
      }
      if (minutes - firstTier > 0) {
        doubletimeSegments.push({
          date,
          minutes: minutes - firstTier,
          arrangement,
        });
      }
      continue;
    }

    // Step 2. The day as three CUMULATIVE bands, each capped by its own
    // threshold, so the three always sum to exactly `minutes`.
    //
    // Taking `min` of BOTH caps for the bottom band is not belt-and-braces:
    // 078 permits a double-time threshold with a NULL daily-overtime
    // threshold (its ordering CHECK passes vacuously when the lower one is
    // null), and computing the bottom band from the daily threshold alone
    // would then leave the whole day in the remainder AND emit a double-time
    // band for its top — the same minutes priced twice, which is §10.1's
    // non-duplication invariant broken in the one direction its named test
    // does not look. Null threshold = that band is unbounded, exactly as
    // before 078.
    const belowDaily =
      dailyThreshold === null ? minutes : Math.min(minutes, dailyThreshold);
    const belowDoubletime =
      doubletimeThreshold === null
        ? minutes
        : Math.min(minutes, doubletimeThreshold);
    const dailyRegular = Math.min(belowDaily, belowDoubletime);
    const doubletimeMinutes = minutes - belowDoubletime;
    const dailyOvertime = minutes - dailyRegular - doubletimeMinutes;

    if (dailyOvertime > 0) {
      overtimeSegments.push({ date, minutes: dailyOvertime, arrangement });
    }
    if (doubletimeMinutes > 0) {
      doubletimeSegments.push({
        date,
        minutes: doubletimeMinutes,
        arrangement,
      });
    }
    if (dailyRegular > 0) {
      remainderByDate.set(date, dailyRegular);
    }
  }

  // Step 3. The weekly threshold, over the remainder alone.
  let cumulativeRemainder = 0;
  for (const date of workedDates) {
    const minutes = remainderByDate.get(date) ?? 0;
    if (minutes === 0) {
      continue;
    }
    const arrangement = resolved.get(date) as PayArrangement;
    // Null threshold = no weekly overtime for this arrangement.
    const regularRoom =
      threshold === null
        ? minutes
        : Math.max(0, Math.min(minutes, threshold - cumulativeRemainder));
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
    cumulativeRemainder += minutes;
  }

  // `toLines` merges CONSECUTIVE same-arrangement segments into one dated
  // line, so the overtime bucket has to be date-ascending before it gets
  // there — it is filled in two passes (daily tiers, then the weekly rule)
  // and a day can legitimately contribute to both. `sort` is stable, so a
  // day's daily-overtime segment stays ahead of its weekly-overtime one and
  // the two merge into a single honest row rather than two rows at the same
  // rate for a nanny to reconcile.
  overtimeSegments.sort((a, b) => a.date.localeCompare(b.date));

  // ---------------------------------------------------------------------
  // THE WORKED-HOLIDAY PREMIUM (3-E4, §5 D-12) — AN INCREMENT, NEVER A
  // RE-PRICING. This is the composition rule; read it before changing
  // anything above.
  //
  //   Hours worked on a household-observed holiday are ORDINARY WORKED TIME
  //   for every purpose the three steps above have. They split into the daily
  //   bands, they can be the seventh day, they count toward the weekly
  //   threshold, and they are already sitting on whichever tier line they
  //   earned. NOTHING above this comment knows about holidays, on purpose.
  //   The premium is then added ON TOP: one line carrying THE SAME MINUTES a
  //   second time at `rate × (multiplier − 1)` — the uplift alone.
  //
  // WHY NOT PRICE THE HOLIDAY WHOLE, the way the seventh day is priced whole?
  // Because it would have to do one of two wrong things. Pull the holiday
  // minutes out of the weekly remainder and a 45-hour week containing a
  // holiday silently shrinks to 32 hours — destroying overtime she actually
  // earned. Leave them in AND price them whole and the same minutes are paid
  // twice, which is precisely §10.1's non-duplication invariant broken.
  //
  // The seventh day is different because it answers the SAME question the
  // daily bands answer — "what tier is this hour in" — so it has to replace
  // them. A holiday answers a different question. "This hour was above the
  // 8-hour daily threshold" and "this hour was worked on the Fourth of July"
  // are two independent facts about one hour, both true, each separately
  // agreed by the parties. The engine pays the hour once at its own tier and
  // the agreed holiday uplift once on top.
  //
  // The consequence, stated so nobody has to rediscover it: `minutes` on a
  // `holiday_premium` line is NOT disjoint from the minutes on the lines
  // above it. It is the only kind where that is true. Nothing in this repo
  // sums minutes across lines; `docs/design/screens-pay-terms.md` §12.2's
  // export gives it its own `holiday_premium_minutes` column for this reason.
  //
  // WHICH ARRANGEMENT. The multiplier comes from `overtimeConfig` — the same
  // arrangement every other multiplier and threshold comes from, the week's
  // last worked day. A multiplier is a TERM, not a fact about a day, and the
  // week is negotiated and signed off as one unit. The base RATE stays
  // per-day, exactly as it does on the `regular` lines beside it, so a
  // mid-week raise splits the premium into two dated rows too.
  //
  // `> 1`, NOT `!== null`. Null means "a worked holiday pays the normal rate"
  // and so does an explicit 1.00, which the column permits (it floors at 1).
  // Emitting a £0.00 uplift row would tell a nanny her family agreed a
  // holiday premium and then paid her nothing for it — a fabricated figure,
  // which §2.9 forbids outright. Same emission-gating reasoning as
  // `doubletime`: a tier with no rate to price it at emits no line at all,
  // and the minutes are not dropped because they were never this line's to
  // begin with — they are already priced above.
  // ---------------------------------------------------------------------
  const workedHolidayMultiplier =
    overtimeConfig.worked_holiday_multiplier ?? null;
  const holidayPremiumSegments: Segment[] =
    workedHolidayMultiplier !== null && workedHolidayMultiplier > 1
      ? workedDates
          .filter(date => observedHolidays.has(date))
          .map(date => ({
            date,
            minutes: workedByDate.get(date) ?? 0,
            arrangement: resolved.get(date) as PayArrangement,
          }))
      : [];

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

  // ---------------------------------------------------------------------
  // THE UNWORKED-HOLIDAY CREDIT (3-E5, §5 D-53) — the segments. Which dates
  // earn one was decided up at `paidHolidayDates` (before `requiredDates`,
  // because a credited date has to be priceable); this is the pricing.
  //
  // THE COMPOSITION RULES, in full, because a later reader will need all
  // four and only two of them are visible from this expression:
  //
  //  1. MUTUALLY EXCLUSIVE WITH 3-E4's PREMIUM, by construction. The gate is
  //     ZERO worked minutes on the date, and the premium's gate is worked
  //     minutes on the date, so one observed holiday can only ever earn one
  //     of the two. That is the honest reading of the terms: the premium
  //     rewards working a day off, the credit pays for not having to.
  //  2. OUTSIDE EVERY OVERTIME THRESHOLD — daily, weekly and the seventh
  //     day — exactly like `pto`. Nothing above this point knows these
  //     minutes exist: the three pricing steps walk `workedDates` alone, and
  //     a credited date is by definition not one. So a credit can never
  //     promote a worked hour into a higher tier, and can never itself be
  //     promoted. §5 D-53: "the credit counts like PTO (outside OT
  //     thresholds)".
  //  3. PAYABLE, so it reduces a guaranteed-hours shortfall — again exactly
  //     like `pto` (see `payableMinutes` below). A week that credited a
  //     holiday must not ALSO top up for the same hours; that would pay one
  //     absence twice.
  //  4. PRICED AT ITS OWN DAY'S ARRANGEMENT, like `regular` and `pto` and
  //     unlike the top-up: two credited holidays either side of a mid-week
  //     raise split into two dated lines at two rates. The MINUTES come from
  //     `overtimeConfig` instead, because how many hours a holiday is worth
  //     is a TERM — the same "the week is negotiated and signed off as one
  //     unit" rule every threshold and multiplier here follows.
  //
  // `> 0`, not `!== null`: 095's CHECK already refuses a stored zero, and a
  // £0.00 credit row would tell a nanny her family agreed a paid holiday and
  // then paid her nothing for it — a fabricated figure (§2.9). Same
  // emission-gating reasoning as `doubletime` and `holiday_premium`.
  // ---------------------------------------------------------------------
  const paidHolidaySegments: Segment[] = paidHolidayDates.map(date => ({
    date,
    minutes: holidayCreditMinutes ?? 0,
    arrangement: resolved.get(date) as PayArrangement,
  }));
  const paidHolidayMinutes =
    paidHolidaySegments.length * (holidayCreditMinutes ?? 0);

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
  // Guaranteed top-up — weekly shortfall, unconditional (owner ruling
  // 2026-08-09, `docs/11-MONEY.md` §7). When payable minutes fall short of
  // `guaranteed_minutes_per_week`, the engine emits a single top-up line for
  // the FULL shortfall — no closure-day gate, no schedule-based cap.
  // Payable minutes already include worked time, paid cancellations, PTO
  // usage and unworked-holiday credits, so a week that paid for those minutes
  // never also tops up for them — no double pay by construction.
  // The guaranteed minutes and the rate come from the week's LAST DAY
  // arrangement, for the same "the week is one unit" reason as the overtime
  // terms — and because a zero-hours week has no other date to ask.
  // ---------------------------------------------------------------------
  const workedMinutes = total(workedByDate);
  const payableMinutes =
    workedMinutes +
    total(cancelledByDate) +
    ptoUsageMinutes +
    paidHolidayMinutes;

  const guaranteedMinutes = lastDayArrangement.guaranteed_minutes_per_week;
  const shortfall =
    guaranteedMinutes === null
      ? 0
      : Math.max(0, guaranteedMinutes - payableMinutes);
  const topupMinutes = shortfall;

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
    // `doubletimeMultiplier` is non-null wherever a segment exists — the two
    // thresholds that feed this bucket are both nulled out above when it is
    // absent, so there is no path to a double-time line with no rate to price
    // it at. The `?? 1` is a type-narrowing floor, never a fallback rate.
    [EARNINGS_LINE_KINDS.DOUBLETIME]: toLines(
      doubletimeSegments,
      EARNINGS_LINE_KINDS.DOUBLETIME,
      doubletimeMultiplier ?? 1
    ),
    // The uplift alone — see the composition comment above. The `?? 1` is a
    // type-narrowing floor and never a fallback multiplier: the segment list
    // is empty whenever the multiplier is null or 1, so this call produces no
    // lines at all in that case.
    [EARNINGS_LINE_KINDS.HOLIDAY_PREMIUM]: toLines(
      holidayPremiumSegments,
      EARNINGS_LINE_KINDS.HOLIDAY_PREMIUM,
      workedHolidayMultiplier ?? 1,
      true
    ),
    [EARNINGS_LINE_KINDS.CANCELLATION_PAID]: toLines(
      cancellationSegments,
      EARNINGS_LINE_KINDS.CANCELLATION_PAID,
      null
    ),
    [EARNINGS_LINE_KINDS.PTO]: usingDatedPto
      ? toLines(ptoSegments, EARNINGS_LINE_KINDS.PTO, null)
      : legacyPtoLines,
    // The ordinary rate, no multiplier — the credit pays the day, it does not
    // reward working it. `paidHolidayDates` is week-ascending, which is what
    // `toLines`' consecutive-segment merge needs.
    [EARNINGS_LINE_KINDS.PAID_HOLIDAY]: toLines(
      paidHolidaySegments,
      EARNINGS_LINE_KINDS.PAID_HOLIDAY,
      null
    ),
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

// =============================================================================
// Salary framing (D-6, `docs/design/screens-pay-terms.md` §10)
// =============================================================================

/**
 * The weekly-equivalent figure for an arrangement's guaranteed hours — D-6's
 * "$1,400/wk guaranteed = $28 × 50h" framing, corrected per §10's own
 * warning that the naive multiply is wrong the moment overtime exists.
 *
 * FORBIDDEN REFACTOR — DO NOT "SIMPLIFY" THIS TO `rate_minor * hours`.
 * §10, verbatim: "A naive rate × hours multiply is forbidden anywhere in
 * this app." That refactor passes every test written against a
 * no-overtime fixture and is silently wrong the instant an arrangement has
 * ANY overtime tier — the spec's own worked example is 50 guaranteed hours
 * at $28.00/hr pricing as $1,540.00 (40 reg + 10 OT at 1.5x), not the naive
 * $1,400.00. This function exists so the figure is priced through the SAME
 * engine (`computeWeekEarnings`) that prices a real week, never a second
 * formula that can drift from it (§10.1's non-duplication invariant is the
 * engine's own, inherited for free by routing through it).
 *
 * `null` when there is no guarantee (or it is zero) — no guarantee, no line
 * (§10: "It renders only when both a rate and guaranteed hours exist"),
 * never a fabricated figure (T16).
 *
 * ASSUMES AN EVEN SPREAD across 5 consecutive days, starting on the
 * arrangement's own `valid_from` — the same assumption the UI states out
 * loud when a daily tier is set ("Assumes five 10-hour days. Longer days add
 * daily overtime."). Starting on `valid_from` itself (never earlier) is what
 * guarantees `effectiveOn` resolves every synthetic day to THIS arrangement
 * and no other, whatever `valid_from` actually falls on.
 */
export function weeklyEquivalentMinor(
  arrangement: PayArrangement
): number | null {
  const guaranteedMinutes = arrangement.guaranteed_minutes_per_week;
  // `== null` (not `===`) deliberately: this also guards a malformed/partial
  // fixture whose field is simply `undefined` — the moment there is nothing
  // to spread, `arrangement.valid_from` is never touched either, so a
  // fixture missing THAT too (a controller test's minimal stub, for
  // instance) is equally safe.
  if (guaranteedMinutes == null || guaranteedMinutes <= 0) {
    return null;
  }

  const SPREAD_DAYS = 5;
  const perDay = Math.floor(guaranteedMinutes / SPREAD_DAYS);
  const remainder = guaranteedMinutes - perDay * SPREAD_DAYS;

  const entries: EarningsTimeEntryInput[] = [];
  for (let i = 0; i < SPREAD_DAYS; i++) {
    // The remainder (guaranteedMinutes not evenly divisible by 5) lands on
    // the last synthetic day — an arbitrary but deterministic choice; which
    // day absorbs a handful of leftover minutes cannot change which OT tier
    // the OTHER four already-even days fall in.
    const minutes = perDay + (i === SPREAD_DAYS - 1 ? remainder : 0);
    if (minutes <= 0) continue;
    entries.push({
      kind: TIME_ENTRY_KINDS.WORKED,
      local_date: addDays(arrangement.valid_from, i),
      minutes,
    });
  }

  const result = computeWeekEarnings({
    week_start: arrangement.valid_from,
    entries,
    arrangements: [arrangement],
    pto_usage: [],
    reimbursements: [],
    observed_holidays: [],
  });

  return result.status === EARNINGS_RESULT_STATUSES.OK
    ? result.gross_minor
    : null;
}
