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
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import type { PayArrangement } from '../types';
import {
  type ClosureDayShiftInput,
  type ComputeWeekEarningsInput,
  computeWeekEarnings,
  type EarningsTimeEntryInput,
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
}

/**
 * Rows in, `ComputeWeekEarningsInput` out. Pure, so the mapping — including
 * the PTO hazard below — is directly assertable.
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

  return {
    week_start: sources.weekStart,
    entries,
    arrangements: sources.arrangements,
    closure_dates: sources.closureDates,
    closure_day_shifts: closureDayShifts,
    // ---------------------------------------------------------------------
    // THE PHASE 3 HAZARD, and why this is hard-coded zero.
    //
    // `pto_usage_minutes` feeds `payable_minutes`, which the guaranteed-hours
    // comparison runs against. Passing real PTO minutes NOW would suppress a
    // guaranteed top-up while no `pto` LINE is emitted to pay for them — the
    // carer would lose the top-up and receive nothing in its place. Zero is
    // the only safe value until Phase 3 prices the line, and
    // `earningsService`'s `ComputeWeekEarningsInput` doc says so at the other
    // end of the same contract. Do not wire the PTO ledger in here without
    // adding the line in the engine in the same change.
    // ---------------------------------------------------------------------
    pto_usage_minutes: 0,
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
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository()
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

    const [entries, arrangements, closures] = await Promise.all([
      this.timeEntryRepo.listForCarerWeek(
        householdId,
        carerId,
        weekStart,
        weekEndExclusive(weekStart)
      ),
      this.arrangementRepo.listForCarer(householdId, carerId),
      this.closureRepo.listByHousehold(householdId),
    ]);

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
      })
    );
  }
}

/** Singleton for services that don't need DI. */
export const weekEarningsService = new WeekEarningsService();
