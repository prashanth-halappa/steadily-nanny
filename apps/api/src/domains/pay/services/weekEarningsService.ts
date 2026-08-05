/**
 * The impure wrapper around the pure earnings engine (TIER0-PLAN.md Phase 2,
 * "Wiring"; `docs/11-MONEY.md` §3).
 *
 * `earningsService.computeWeekEarnings` is deliberately I/O-free so its case
 * table can be exhaustive. Something still has to go and get the week: this
 * module is that something, and NOTHING ELSE. It fetches, it maps, it calls
 * the engine. It performs no pricing arithmetic of its own — the only
 * numbers it computes are minutes, and both of those computations are
 * borrowed rather than rewritten (`computeWorkedMinutes` from the timesheet
 * domain's leaf util, so a week's money can never disagree with the same
 * week's `total_minutes`).
 *
 * SCOPING (D12): every repository here uses the service-role client and so
 * bypasses RLS. Each query below therefore carries its own
 * `household_id`/`carer_id` filter, and the one query that cannot
 * (`findByHouseholdAndLocalDate`, household-scoped only) is narrowed to this
 * carer in process before anything is priced. Authorization — may this caller
 * see this week at all — belongs to the calling service, not here.
 *
 * @module domains/pay/services/weekEarningsService
 */
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { EXPENSE_STATUSES } from '@steadily-nanny/shared-types/schemas/expense.schema';
import type { PtoLedgerEntry } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { PTO_LEDGER_KINDS } from '@steadily-nanny/shared-types/schemas/pto.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type {
  TimeEntry,
  WeekEarnings,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { HouseholdClosureRepository } from '../../availability/repositories/householdClosureRepository';
import { HouseholdRepository } from '../../household';
import { ShiftRepository } from '../../shift/repositories/shiftRepository';
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { localDateOf, weekEndExclusive } from '../../timesheet/utils/weekStart';
import { computeWorkedMinutes } from '../../timesheet/utils/workedMinutes';
import { ExpenseRepository } from '../repositories/expenseRepository';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import { PtoLedgerRepository } from '../repositories/ptoLedgerRepository';
import type { PayArrangement } from '../types';
import {
  type ApprovedExpenseInput,
  type ClosureDayShiftInput,
  type ComputeWeekEarningsInput,
  computeWeekEarnings,
  type EarningsTimeEntryInput,
  type PtoUsageInput,
} from './earningsService';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

/**
 * Shift statuses whose scheduled minutes can be LOST to a closure.
 *
 * `draft` and `declined` are excluded: a draft was never issued and a
 * declined shift was never agreed, so neither represents work the carer was
 * promised and the closure then took away. `cancelled` very much is included
 * — a shift cancelled *because* the family is away is the archetypal lost
 * shift, and whether it was cancelled early enough to be paid is already
 * answered by `became_payable`, not by the status.
 */
const SCHEDULED_SHIFT_STATUSES: ReadonlySet<string> = new Set([
  SHIFT_STATUSES.PENDING,
  SHIFT_STATUSES.CONFIRMED,
  SHIFT_STATUSES.CANCELLED,
  SHIFT_STATUSES.COMPLETED,
]);

/** Pure `YYYY-MM-DD` arithmetic, UTC-anchored — the house convention (`utils/weekStart.ts`). */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) + days * MS_PER_DAY
  );
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * The household-local dates in `[weekStart, weekStart+7)` that a closure
 * covers, ascending and deduped.
 *
 * `household_closures.ends_at` is EXCLUSIVE — the all-day convention the
 * client writes (`toAllDayRange` in
 * `apps/mobile/src/domains/timeOff/utils/timeOffDate.ts`: local midnight of
 * the day AFTER the last selected day). So the covered span is
 * `[localDate(starts_at), localDate(ends_at))`.
 *
 * One deliberate softening: a sub-day closure (both instants on the same
 * local date, so the half-open range is empty) still counts as ONE closure
 * date. Dropping it would silently make a real closure invisible to the
 * top-up; counting it can at most let a partly-closed day contribute its
 * unworked scheduled minutes, which is what a closure day means anyway.
 *
 * Resolved in the HOUSEHOLD's timezone, never UTC — the same reason
 * `weekStartOf` exists: 23:30 UTC is already tomorrow east of UTC, and a
 * closure filed on the wrong day moves money.
 */
export function closureDatesInWeek(
  closures: readonly HouseholdClosure[],
  weekStart: string,
  timeZone: string
): string[] {
  const weekEnd = addDays(weekStart, DAYS_PER_WEEK); // exclusive
  const dates = new Set<string>();
  for (const closure of closures) {
    const first = localDateOf(new Date(closure.starts_at), timeZone);
    const endExclusive = localDateOf(new Date(closure.ends_at), timeZone);
    const last = endExclusive > first ? endExclusive : addDays(first, 1);
    for (let date = first; date < last; date = addDays(date, 1)) {
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
  closureDates: readonly string[];
  /** Shifts on those closure dates, already narrowed to this carer. */
  closureDayShifts: readonly Shift[];
  /**
   * THIS carer's PTO ledger rows (`ptoLedgerRepo.listForCarerYear`, already
   * household- AND carer-scoped by its own arguments) for the calendar
   * year(s) the week falls in — EVERY kind, unfiltered by date. Deliberately
   * raw: `buildWeekEarningsInput` is where the narrowing to `usage` rows
   * dated inside `[weekStart, weekStart+6]`, and the ledger's
   * negative-minutes-to-positive-minutes conversion, happen — see the doc
   * there.
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
 * Rows in, `ComputeWeekEarningsInput` out. Pure, so the mapping — including
 * the PTO sign conversion and the reimbursement status filter below — is
 * directly assertable.
 */
export function buildWeekEarningsInput(
  sources: WeekEarningsSources
): ComputeWeekEarningsInput {
  const payableShiftIds = new Set<string>();
  const entries: EarningsTimeEntryInput[] = [];

  for (const entry of sources.entries) {
    // A running entry has no minutes yet. Skipped rather than treated as
    // zero-length, exactly as `sumWorkedMinutes` skips it, so the priced
    // week and `total_minutes` agree on which entries count.
    if (!entry.clock_in_at || !entry.clock_out_at) {
      continue;
    }
    entries.push({
      kind: entry.kind,
      local_date: entry.local_date,
      minutes: computeWorkedMinutes(
        entry.clock_in_at,
        entry.clock_out_at,
        entry.break_minutes
      ),
    });
    if (entry.shift_id) {
      // This shift produced payable minutes (worked, or a paid cancellation),
      // so it is already in `payable_minutes` and must NOT also count as lost.
      payableShiftIds.add(entry.shift_id);
    }
  }

  const closureDayShifts: ClosureDayShiftInput[] = sources.closureDayShifts
    .filter(shift => SCHEDULED_SHIFT_STATUSES.has(shift.status))
    .map(shift => ({
      local_date: shift.local_date,
      scheduled_minutes: Math.round(
        (new Date(shift.ends_at).getTime() -
          new Date(shift.starts_at).getTime()) /
          60_000
      ),
      became_payable: payableShiftIds.has(shift.id),
    }));

  // The week's last local date, inclusive — the same boundary
  // `computeWeekEarnings` uses for `week_end` and for filtering
  // `reimbursements`. PTO usage rows are narrowed to this same window below,
  // since (unlike reimbursements) the engine does NOT filter `pto_usage` by
  // date itself — an out-of-week row would otherwise silently price and,
  // worse, silently count toward `payable_minutes`.
  const weekEnd = addDays(sources.weekStart, DAYS_PER_WEEK - 1);

  // PTO USAGE — was a hard-coded zero (the "Phase 3 hazard"); now real.
  //
  // `pto_ledger` stores a `usage` row's minutes NEGATIVE (accrual +, usage
  // −, `043_pto_ledger.sql`); the engine's `PtoUsageInput.minutes` must be
  // POSITIVE to price (see `pto_usage`'s doc on `ComputeWeekEarningsInput`
  // in `earningsService.ts`). Negating is the ENTIRE sign conversion — get
  // it backwards and the engine either prices negative PTO or, after the
  // engine's own `Math.max(0, …)` clamp, silently prices nothing at all,
  // which is exactly the old hazard this replaces. `accrual`/`adjustment`
  // rows are excluded outright: only a `usage` row represents time actually
  // taken, and the deliberate consequence of always passing `pto_usage`
  // (even as `[]`) rather than falling back to the deprecated
  // `pto_usage_minutes` is that "no PTO this week" is stated, not implied.
  const ptoUsage: PtoUsageInput[] = sources.ptoLedgerRows
    .filter(
      row =>
        row.kind === PTO_LEDGER_KINDS.USAGE &&
        row.effective_date >= sources.weekStart &&
        row.effective_date <= weekEnd
    )
    .map(row => ({
      local_date: row.effective_date,
      minutes: -row.minutes,
    }));

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
    closure_dates: sources.closureDates,
    closure_day_shifts: closureDayShifts,
    pto_usage: ptoUsage,
    reimbursements,
  };
}

/** Only the closure query this service needs — keeps the test double honest. */
export interface WeekEarningsClosureRepository {
  listByHousehold: (householdId: string) => Promise<HouseholdClosure[]>;
}

/** Only the shift query this service needs. Read-only: the shift domain owns its own writes. */
export interface WeekEarningsShiftRepository {
  findByHouseholdAndLocalDate: (
    householdId: string,
    localDate: string
  ) => Promise<Shift[]>;
}

/**
 * Only the PTO ledger query this service needs. Household- AND
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
 * Only the expense query this service needs. Household-scoped only — like
 * `WeekEarningsShiftRepository`, `computeForWeek` narrows the result to this
 * carer in process before pricing (D12 scoping).
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
    private readonly closureRepo: WeekEarningsClosureRepository = new HouseholdClosureRepository(),
    private readonly shiftRepo: WeekEarningsShiftRepository = new ShiftRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
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
    const household = await this.householdRepo.findById(householdId);
    const timeZone = household?.timezone ?? 'UTC';

    // `listForCarerYear` is a CALENDAR-YEAR query (`043_pto_ledger.sql`'s PTO
    // year, owner decision 3), not a date-range one, so a week that spans a
    // year boundary (Mon 29 Dec .. Sun 4 Jan) needs both years fetched — the
    // common case is one year, but assuming that would silently drop a New
    // Year's PTO usage row.
    const weekEnd = addDays(weekStart, DAYS_PER_WEEK - 1);
    const startYear = Number(weekStart.slice(0, 4));
    const endYear = Number(weekEnd.slice(0, 4));
    const ptoYears = startYear === endYear ? [startYear] : [startYear, endYear];

    const [entries, arrangements, closures, ptoLedgerRowsPerYear, expenses] =
      await Promise.all([
        this.timeEntryRepo.listForCarerWeek(
          householdId,
          carerId,
          weekStart,
          weekEndExclusive(weekStart)
        ),
        this.arrangementRepo.listForCarer(householdId, carerId),
        this.closureRepo.listByHousehold(householdId),
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
    // `listApprovedForWeek` is household-scoped only (like
    // `findByHouseholdAndLocalDate` below) — narrowed to this carer HERE,
    // in process, before anything is priced (D12 scoping, module doc).
    const approvedExpenses = expenses.filter(
      expense => expense.carer_id === carerId
    );

    const closureDates = closureDatesInWeek(closures, weekStart, timeZone);
    // At most seven dates, and usually zero — a per-date fetch is cheaper
    // than widening the query, and it reuses the index the calendar already
    // relies on. No closure days, no shift query at all.
    const shiftsPerDate = await Promise.all(
      closureDates.map(date =>
        this.shiftRepo.findByHouseholdAndLocalDate(householdId, date)
      )
    );
    const closureDayShifts = shiftsPerDate
      .flat()
      .filter(shift => shift.carer_id === carerId);

    return computeWeekEarnings(
      buildWeekEarningsInput({
        weekStart,
        entries,
        arrangements,
        closureDates,
        closureDayShifts,
        ptoLedgerRows,
        approvedExpenses,
      })
    );
  }
}

/** Singleton for services that don't need DI. */
export const weekEarningsService = new WeekEarningsService();
