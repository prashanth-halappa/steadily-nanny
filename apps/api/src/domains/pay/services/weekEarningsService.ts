/**
 * The impure wrapper around the pure earnings engine (TIER0-PLAN.md Phase 2,
 * "Wiring"; `docs/11-MONEY.md` §3).
 *
 * `earningsService.computeWeekEarnings` is deliberately I/O-free so its case
 * table can be exhaustive. Something still has to go and get the week: this
 * module is that something, and NOTHING ELSE. It fetches, it maps, it calls
 * the engine. It performs no pricing arithmetic of its own — the only
 * numbers it computes are minutes, and both of those computations are
 * borrowed rather than rewritten (`entryMinutes` from the timesheet domain's
 * leaf util, so a week's money can never disagree with the same week's
 * `total_minutes`).
 *
 * SCOPING (D12): every repository here uses the service-role client and so
 * bypasses RLS. Each query below therefore carries its own
 * `household_id`/`carer_id` filter. Authorization — may this caller see this
 * week at all — belongs to the calling service, not here.
 *
 * @module domains/pay/services/weekEarningsService
 */
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { EXPENSE_STATUSES } from '@steadily-nanny/shared-types/schemas/expense.schema';
import type { PtoLedgerEntry } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { PTO_LEDGER_KINDS } from '@steadily-nanny/shared-types/schemas/pto.schema';
import type {
  TimeEntry,
  WeekEarnings,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { weekEndExclusive } from '../../timesheet/utils/weekStart';
import { entryMinutes } from '../../timesheet/utils/workedMinutes';
import { ExpenseRepository } from '../repositories/expenseRepository';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import { PtoLedgerRepository } from '../repositories/ptoLedgerRepository';
import type { PayArrangement } from '../types';
import { allocateMinutes } from '../utils/allocateMinutes';
import { addDays, localDatesCovered } from '../utils/localDateSpan';
import {
  type ApprovedExpenseInput,
  type ComputeWeekEarningsInput,
  computeWeekEarnings,
  type EarningsTimeEntryInput,
  type PtoUsageInput,
} from './earningsService';

const DAYS_PER_WEEK = 7;

/**
 * The household-local dates in `[weekStart, weekStart+7)` that a closure
 * covers, ascending and deduped.
 *
 * The span rule itself — `ends_at` EXCLUSIVE, a sub-day span still counting
 * as one date, resolved in the household's timezone — lives in
 * `localDatesCovered` (`utils/localDateSpan.ts`), because a PTO marking now
 * needs the identical answer for a time off (Phase 3/4 review, finding 15b)
 * and two copies of a date rule this subtle drift apart. This function is
 * only the week window on top of it.
 */
export function closureDatesInWeek(
  closures: readonly HouseholdClosure[],
  weekStart: string,
  timeZone: string
): string[] {
  const weekEnd = addDays(weekStart, DAYS_PER_WEEK); // exclusive
  const dates = new Set<string>();
  for (const closure of closures) {
    for (const date of localDatesCovered(
      closure.starts_at,
      closure.ends_at,
      timeZone
    )) {
      if (date >= weekStart && date < weekEnd) {
        dates.add(date);
      }
    }
  }
  return [...dates].sort();
}

/** Rows the engine input is assembled from — all already fetched and scoped. */
export interface WeekEarningsSources {
  weekStart: string;
  /** THIS carer's entries for THIS week (`listForCarerWeek`). */
  entries: readonly TimeEntry[];
  /** The carer's FULL append-only history — the engine resolves per-date itself. */
  arrangements: readonly PayArrangement[];
  /**
   * THIS carer's PTO ledger rows (`ptoLedgerRepo.listForCarerYear`, already
   * household- AND carer-scoped by its own arguments) for the calendar
   * year(s) the week falls in — EVERY kind, unfiltered by date, and that
   * breadth is load-bearing: the reversing `adjustment` rows are what stop a
   * cancelled-then-worked day pricing twice. Deliberately raw:
   * `buildWeekEarningsInput` is where the netting per `time_off_id`, the
   * narrowing to `[weekStart, weekStart+6]`, and the ledger's
   * negative-minutes-to-positive-minutes conversion all happen — see
   * `netPtoUsage`.
   */
  ptoLedgerRows: readonly PtoLedgerEntry[];
  /**
   * Expenses/mileage for THIS carer this week, already narrowed to this
   * carer in `computeForWeek` (D12 scoping — `expenseRepo.listApprovedForWeek`
   * is household-scoped only, exactly like `payArrangementRepository.
   * listForCarer` is carer-scoped by its own arguments while
   * `findByHouseholdAndLocalDate` is not). `buildWeekEarningsInput`'s own
   * `status === 'approved'` filter below is defense in depth, not the real
   * gate — the repository query already selects `status = 'approved'` only.
   */
  approvedExpenses: readonly Expense[];
}

/**
 * The week's PTO, netted per `time_off_id` — one priced entry per time off
 * that this household is still paying for, dated on the day the leave was
 * taken.
 *
 * WHY NETTING LIVES HERE AND NOT IN THE ENGINE (Phase 3/4 review, BLOCKER
 * 2). The bug it fixes: `markTimeOffPaid` records a `usage` row and a
 * cancellation (or a downward correction) records a reversing `adjustment`
 * row against the same `time_off_id`; this function fed the engine ONLY the
 * usage rows, so a day that was marked paid, cancelled, and then actually
 * worked priced a `pto` line AND a `regular` line for the same eight hours —
 * double pay, frozen on approval.
 *
 * The netting belongs in this wrapper because the engine is pure and takes
 * priced FACTS ("this many PTO minutes on this date"), not storage. `kind`,
 * the negative-minutes convention, the FK that ties a correction to the
 * usage row it corrects — all of that is `pto_ledger`'s shape, and this
 * module is already the one place that translates it (the sign conversion
 * and the week window live here too). Teaching the engine about ledger rows
 * would widen its input from facts to storage and give the same rule two
 * homes.
 *
 * The rules, each pinned by a test:
 * - Rows GROUP by `time_off_id`; `accrual` rows and free-standing
 *   `adjustment` rows (no `time_off_id`) are excluded outright — a grant is
 *   not time taken and an untied correction is a balance adjustment, not a
 *   day off.
 * - A group's DATE comes from its `usage` row, never from an adjustment: the
 *   reversal is bookkeeping that can be filed any day, while the usage row
 *   records when the leave actually was. That is also why a group with no
 *   usage row in the fetched set prices nothing — there is no day to price
 *   it on, and its usage row (if any) belongs to another week's calculation.
 * - The netted minutes are `-sum(group)`, so a partial reversal prices the
 *   REMAINDER and an upward correction prices the increase, clamped at zero
 *   so an over-reversal can never price negative PTO (which would silently
 *   reduce `payable_minutes` and manufacture a guaranteed-hours top-up).
 * - The week filter applies to the GROUP's date, after netting — so a
 *   reversal filed weeks later still cancels its in-week usage row.
 */
function netPtoUsage(
  rows: readonly PtoLedgerEntry[],
  weekStart: string,
  weekEnd: string
): PtoUsageInput[] {
  const groups = new Map<
    string,
    { perDate: Map<string, number>; total: number }
  >();

  for (const row of rows) {
    if (!row.time_off_id) {
      continue; // accrual, or a free-standing balance correction
    }
    if (
      row.kind !== PTO_LEDGER_KINDS.USAGE &&
      row.kind !== PTO_LEDGER_KINDS.ADJUSTMENT
    ) {
      continue;
    }
    const group = groups.get(row.time_off_id) ?? {
      perDate: new Map<string, number>(),
      total: 0,
    };
    // Stored negative (accrual +, usage −, `043_pto_ledger.sql`); the
    // engine's `PtoUsageInput.minutes` must be POSITIVE to price (see
    // `pto_usage`'s doc on `ComputeWeekEarningsInput`). Negating here is the
    // ENTIRE sign conversion — get it backwards and the engine either prices
    // negative PTO or, after its own `Math.max(0, …)` clamp, silently prices
    // nothing at all.
    group.total -= row.minutes;
    if (row.kind === PTO_LEDGER_KINDS.USAGE) {
      // Only a USAGE row declares that leave was taken on a date. An
      // adjustment contributes to the total but never invents a new day: a
      // correction filed on a date with no usage is bookkeeping, not a day
      // off, and pricing it would pay for a day nobody took.
      group.perDate.set(
        row.effective_date,
        (group.perDate.get(row.effective_date) ?? 0) - row.minutes
      );
    } else if (group.perDate.has(row.effective_date)) {
      group.perDate.set(
        row.effective_date,
        (group.perDate.get(row.effective_date) ?? 0) - row.minutes
      );
    }
    groups.set(row.time_off_id, group);
  }

  const usage: PtoUsageInput[] = [];
  for (const group of groups.values()) {
    const dates = [...group.perDate.keys()].sort();
    if (dates.length === 0) {
      continue; // adjustments only — no day to price them on
    }
    const total = Math.max(0, group.total);
    if (total === 0) {
      continue; // fully reversed, or over-reversed — no PTO to price
    }
    // The group's NETTED total is the unit of truth (`docs/11-MONEY.md` §5);
    // the per-date figures are how it is attributed. Allocating the total
    // across the dates by those figures makes the two agree exactly: when
    // every adjustment matched a usage date (everything this service writes)
    // the weights already sum to the total and each date keeps its own
    // number; when one did not — a hand-written correction dated elsewhere —
    // the total still wins and is spread proportionally rather than ignored.
    const allocated = allocateMinutes(
      total,
      dates.map(date => Math.max(0, group.perDate.get(date) ?? 0))
    );
    for (const [index, date] of dates.entries()) {
      const minutes = allocated[index] ?? 0;
      if (minutes <= 0 || date < weekStart || date > weekEnd) {
        continue;
      }
      usage.push({ local_date: date, minutes });
    }
  }
  return usage.sort((a, b) => a.local_date.localeCompare(b.local_date));
}

/**
 * Rows in, `ComputeWeekEarningsInput` out. Pure, so the mapping — including
 * the PTO netting and sign conversion and the reimbursement status filter
 * below — is directly assertable.
 */
export function buildWeekEarningsInput(
  sources: WeekEarningsSources
): ComputeWeekEarningsInput {
  const entries: EarningsTimeEntryInput[] = [];

  for (const entry of sources.entries) {
    // 069: voided did not happen — no banked minutes. Skipped before
    // `entryMinutes` so a voided row cannot price or count toward payable
    // minutes.
    if (entry.status === 'voided') {
      continue;
    }
    // A running entry has no minutes yet — `entryMinutes` returns null for
    // it, and it is skipped rather than treated as zero-length, exactly as
    // `sumWorkedMinutes` skips it, so the priced week and `total_minutes`
    // agree on which entries count AND on what each one is worth (including
    // the C7 `scheduled_minutes` branch for cancellation fragments).
    const minutes = entryMinutes(entry);
    if (minutes === null) {
      continue;
    }
    entries.push({
      kind: entry.kind,
      local_date: entry.local_date,
      minutes,
    });
  }

  // The week's last local date, inclusive — the same boundary
  // `computeWeekEarnings` uses for `week_end` and for filtering
  // `reimbursements`. PTO usage rows are narrowed to this same window below,
  // since (unlike reimbursements) the engine does NOT filter `pto_usage` by
  // date itself — an out-of-week row would otherwise silently price and,
  // worse, silently count toward `payable_minutes`.
  const weekEnd = addDays(sources.weekStart, DAYS_PER_WEEK - 1);

  // PTO USAGE — was a hard-coded zero (the "Phase 3 hazard"), then raw
  // `usage` rows (which double-paid a cancelled-then-worked day); now the
  // NETTED total per time off.
  const ptoUsage = netPtoUsage(
    sources.ptoLedgerRows,
    sources.weekStart,
    weekEnd
  );

  // REIMBURSEMENTS — was never passed at all; now the week's APPROVED
  // expenses/mileage. `status === 'approved'` is re-checked here even though
  // `expenseRepo.listApprovedForWeek` already selects only approved rows
  // (the same defense-in-depth discipline `SCHEDULED_SHIFT_STATUSES` above
  // applies to shifts) — pending and rejected claims must never reach the
  // engine, full stop, not "reach it because a future caller changed the
  // query". `amount_minor` is already frozen (mileage at approval, a plain
  // expense at submission); this function only maps it through.
  const reimbursements: ApprovedExpenseInput[] = [];
  for (const expense of sources.approvedExpenses) {
    if (
      expense.status !== EXPENSE_STATUSES.APPROVED ||
      expense.amount_minor === null
    ) {
      continue;
    }
    reimbursements.push({
      local_date: expense.local_date,
      amount_minor: expense.amount_minor,
      currency: expense.currency,
    });
  }

  return {
    week_start: sources.weekStart,
    entries,
    arrangements: sources.arrangements,
    pto_usage: ptoUsage,
    reimbursements,
  };
}

/** Only the PTO ledger query this service needs. Household- AND
 * carer-scoped by its own arguments (unlike `WeekEarningsShiftRepository`'s
 * `findByHouseholdAndLocalDate`), so `computeForWeek` needs no further
 * in-process narrowing before handing the rows to `buildWeekEarningsInput`.
 */
export interface WeekEarningsPtoRepository {
  listForCarerYear: (
    householdId: string,
    carerId: string,
    year: number
  ) => Promise<PtoLedgerEntry[]>;
}

/**
 * Only the expense query this service needs. Household-scoped only —
 * `computeForWeek` narrows the result to this carer in process before pricing
 * (D12 scoping).
 */
export interface WeekEarningsExpenseRepository {
  listApprovedForWeek: (
    householdId: string,
    weekStart: string,
    weekEndExclusive: string
  ) => Promise<Expense[]>;
}

/**
 * The seam consumers depend on — one method, the only one anything outside
 * this module calls. Declared as an interface (rather than the class) for the
 * same reason `TimesheetPushNotifier` is: it keeps the timesheet domain's
 * dependency on the pay domain one function wide, and lets a caller's tests
 * supply a stub without constructing five repositories.
 */
export interface WeekEarningsComputer {
  computeForWeek: (
    householdId: string,
    carerId: string,
    weekStart: string
  ) => Promise<WeekEarnings>;
}

export class WeekEarningsService implements WeekEarningsComputer {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly arrangementRepo: PayArrangementRepository = new PayArrangementRepository(),
    private readonly ptoRepo: WeekEarningsPtoRepository = new PtoLedgerRepository(),
    private readonly expenseRepo: WeekEarningsExpenseRepository = new ExpenseRepository()
  ) {}

  /**
   * Price one (household, carer, week). Read-only: nothing here writes, and
   * in particular nothing here touches the snapshot columns — freezing is
   * `timesheetCommandService.approve`'s job alone (`docs/11-MONEY.md` §3).
   */
  async computeForWeek(
    householdId: string,
    carerId: string,
    weekStart: string
  ): Promise<WeekEarnings> {
    // `listForCarerYear` is a CALENDAR-YEAR query (`043_pto_ledger.sql`'s PTO
    // year, owner decision 3), not a date-range one, so a week that spans a
    // year boundary (Mon 29 Dec .. Sun 4 Jan) needs both years fetched — the
    // common case is one year, but assuming that would silently drop a New
    // Year's PTO usage row.
    const weekEnd = addDays(weekStart, DAYS_PER_WEEK - 1);
    const startYear = Number(weekStart.slice(0, 4));
    const endYear = Number(weekEnd.slice(0, 4));
    const ptoYears = startYear === endYear ? [startYear] : [startYear, endYear];

    const [entries, arrangements, ptoLedgerRowsPerYear, expenses] =
      await Promise.all([
        this.timeEntryRepo.listForCarerWeek(
          householdId,
          carerId,
          weekStart,
          weekEndExclusive(weekStart)
        ),
        this.arrangementRepo.listForCarer(householdId, carerId),
        Promise.all(
          ptoYears.map(year =>
            this.ptoRepo.listForCarerYear(householdId, carerId, year)
          )
        ),
        this.expenseRepo.listApprovedForWeek(
          householdId,
          weekStart,
          weekEndExclusive(weekStart)
        ),
      ]);

    const ptoLedgerRows = ptoLedgerRowsPerYear.flat();
    // `listApprovedForWeek` is household-scoped only — narrowed to this carer
    // HERE, in process, before anything is priced (D12 scoping, module doc).
    const approvedExpenses = expenses.filter(
      expense => expense.carer_id === carerId
    );

    return computeWeekEarnings(
      buildWeekEarningsInput({
        weekStart,
        entries,
        arrangements,
        ptoLedgerRows,
        approvedExpenses,
      })
    );
  }
}

/** Singleton for services that don't need DI. */
export const weekEarningsService = new WeekEarningsService();
