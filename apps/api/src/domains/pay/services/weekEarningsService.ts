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

import {
  HOLIDAY_COUNTRIES,
  observedHolidayDates,
} from '@steadily-nanny/shared-types/holidayPacks';
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Expense } from '@steadily-nanny/shared-types/schemas/expense.schema';
import { EXPENSE_STATUSES } from '@steadily-nanny/shared-types/schemas/expense.schema';
import type {
  HouseholdCustomHoliday,
  HouseholdHoliday,
} from '@steadily-nanny/shared-types/schemas/householdHoliday.schema';
import type { PtoLedgerEntry } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { PTO_LEDGER_KINDS } from '@steadily-nanny/shared-types/schemas/pto.schema';
import type {
  TimeEntry,
  WeekEarnings,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
// Repository MODULE, never the household domain's barrel — importing the
// barrel here would close an import cycle (the household domain reaches into
// pay for arrangement gating).
import { HouseholdCustomHolidayRepository } from '../../household/repositories/householdCustomHolidayRepository';
import { HouseholdHolidayRepository } from '../../household/repositories/householdHolidayRepository';
import { HouseholdRepository } from '../../household/repositories/householdRepository';
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
  /**
   * THIS household's holiday toggles (`household_holidays`, migration 080) —
   * ALL of them, unfiltered, because the rows carry a KEY and not a date and
   * only `observedHolidayDates` knows which keys land in this week.
   *
   * Household-scoped, not carer-scoped: the calendar belongs to the family
   * (spec §4.3, "the list is household-level"). What a worked holiday PAYS is
   * carer-scoped and lives on the arrangement instead.
   *
   * Optional so every existing caller and fixture is unaffected; omitted
   * means no observed holidays, which is also what an empty table means (080:
   * absence is "nothing agreed", never "all of them").
   */
  householdHolidays?: readonly HouseholdHoliday[];
  /**
   * ISO-3166 alpha-2 of this household, when the row has it. Optional so
   * every existing caller and a database that has not had migration 107
   * applied (`country` reads as undefined) fall through to the US pack at
   * the resolver rather than crashing a week.
   */
  country?: string;
  /**
   * THIS household's authored days (`household_custom_holidays`, migration
   * 107) — ALL of them. Dates are already ISO; the resolver unions them with
   * pack dates, dedupes (a custom date equal to a pack date is one date),
   * and clips to the week. The row existing IS the observance.
   *
   * Optional so every existing caller and fixture is unaffected; omitted
   * means no custom days, which is also what an empty table means.
   */
  customHolidays?: readonly HouseholdCustomHoliday[];
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

  // OBSERVED HOLIDAYS — the household's toggles AND authored custom dates,
  // resolved into THIS week's dates. The whole key-to-date rule (plus the
  // custom-date union and dedupe) lives in one call, and this is its only
  // production caller: the engine takes dates because it takes priced facts,
  // not storage (`observed_holidays`'s doc on `ComputeWeekEarningsInput`), and
  // `observedHolidayDates` is where "the third Monday in January" becomes
  // "2027-01-18", and where a custom ISO date is admitted if it falls in the
  // week. A key this build has no rule for in this country's pack resolves to
  // nothing rather than to a guessed date — inventing when a premium is owed
  // is the same class of fabrication as inventing an amount. The helper spans
  // both calendar years for a week that straddles New Year, so a worked Jan 1
  // in a week that starts in December is not silently unpaid. `country`
  // missing (pre-107) falls back to the US pack so pricing degrades to
  // today's behaviour rather than crashing.
  const customDates = (sources.customHolidays ?? []).flatMap(
    holiday => holiday.dates
  );
  const observedHolidays = observedHolidayDates(
    sources.country ?? HOLIDAY_COUNTRIES.US,
    (sources.householdHolidays ?? [])
      .filter(holiday => holiday.observed)
      .map(holiday => holiday.holiday_key),
    customDates,
    sources.weekStart,
    weekEnd
  );

  return {
    week_start: sources.weekStart,
    entries,
    arrangements: sources.arrangements,
    pto_usage: ptoUsage,
    reimbursements,
    observed_holidays: observedHolidays,
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
/**
 * Only the holiday query this service needs. HOUSEHOLD-scoped, with no carer
 * argument at all — the calendar belongs to the family, and adding a carer
 * parameter here would invite a future caller to scope it wrongly.
 */
export interface WeekEarningsHolidayRepository {
  listForHousehold: (householdId: string) => Promise<HouseholdHoliday[]>;
}

/**
 * Only the household row this service needs — `country`, so the pack
 * resolver knows US vs CA. HOUSEHOLD-scoped (`findById` of this household),
 * with no carer argument. `country` is optional on the row: a database that
 * has not had migration 107 applied returns undefined, and pricing falls
 * back to the US pack.
 */
export interface WeekEarningsHouseholdRepository {
  findById: (householdId: string) => Promise<{ country?: string } | null>;
}

/**
 * Only the custom-holiday query this service needs. HOUSEHOLD-scoped, with
 * no carer argument at all — authored days belong to the family, same as the
 * toggle table. The row existing IS the observance.
 */
export interface WeekEarningsCustomHolidayRepository {
  listForHousehold: (householdId: string) => Promise<HouseholdCustomHoliday[]>;
}

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
    private readonly expenseRepo: WeekEarningsExpenseRepository = new ExpenseRepository(),
    private readonly holidayRepo: WeekEarningsHolidayRepository = new HouseholdHolidayRepository(),
    private readonly householdRepo: WeekEarningsHouseholdRepository = new HouseholdRepository(),
    private readonly customHolidayRepo: WeekEarningsCustomHolidayRepository = new HouseholdCustomHolidayRepository()
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
    const arrangements = await this.arrangementRepo.listForCarer(
      householdId,
      carerId
    );
    return this.priceWeek(householdId, carerId, weekStart, arrangements);
  }

  /**
   * Same pricing, with the arrangement HISTORY supplied by the caller rather
   * than fetched — the seam `payArrangementCommandService` uses for §7.4's
   * backdated-reduction comparison (D-42/M1): price the SAME week once
   * against the arrangements as they stood BEFORE a new row was appended and
   * once AFTER, and compare the two `gross_minor` figures. Everything else
   * (entries, PTO, expenses, holidays) is unaffected by which arrangement
   * history is passed, so it is fetched once and reused for both calls —
   * see `priceWeek`.
   */
  async computeForWeekWithArrangements(
    householdId: string,
    carerId: string,
    weekStart: string,
    arrangements: readonly PayArrangement[]
  ): Promise<WeekEarnings> {
    return this.priceWeek(householdId, carerId, weekStart, arrangements);
  }

  private async priceWeek(
    householdId: string,
    carerId: string,
    weekStart: string,
    arrangements: readonly PayArrangement[]
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

    const [
      entries,
      ptoLedgerRowsPerYear,
      expenses,
      householdHolidays,
      household,
      customHolidays,
    ] = await Promise.all([
      this.timeEntryRepo.listForCarerWeek(
        householdId,
        carerId,
        weekStart,
        weekEndExclusive(weekStart)
      ),
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
      // Every toggle, unfiltered: the rows hold KEYS, and only
      // `buildWeekEarningsInput` knows which keys land in this week. There
      // are at most eleven of them per household.
      this.holidayRepo.listForHousehold(householdId),
      // Country lives on the household row (107). Missing column → undefined
      // → US pack at the resolver, same as today's behaviour.
      this.householdRepo.findById(householdId),
      // Authored days, unfiltered: dates are already ISO, and only
      // `buildWeekEarningsInput` knows which fall in this week.
      this.customHolidayRepo.listForHousehold(householdId),
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
        householdHolidays,
        country: household?.country,
        customHolidays,
      })
    );
  }
}

/** Singleton for services that don't need DI. */
export const weekEarningsService = new WeekEarningsService();
