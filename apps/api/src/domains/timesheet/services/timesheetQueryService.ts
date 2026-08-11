/**
 * Timesheet query service (CQRS-lite: reads only). Two different ownership
 * shapes live here: a time entry belongs to a CARER (checked by
 * `carer_id === userId`, not household membership — a nanny's own clock
 * history is hers alone to read), while a household-scoped list or a
 * timesheet is gated by MEMBERSHIP, exactly like the household/schedule/
 * shift domains — see `../../household`, imported READ-ONLY for
 * `HouseholdMemberRepository`/`HouseholdRepository`.
 *
 * THE MEMBERSHIP GATES SPLIT IN TWO, and the split is the point:
 * `assertPayrollReader` (reads) resolves a scope from the caller's ROLE and
 * ignores her status, because payroll is an audit trail — a nanny who has left
 * still reads her own weeks, and a helper reads none of them, ever (D-21);
 * `loadOwnedRow`/`getOwnedTimeEntry` (the lookups behind every ACTION) still
 * require an ACTIVE membership, which is what keeps F-B3b-3 closed.
 * `getOwnedTimesheet` and `getReadableTimesheet` load the same row through
 * those two different gates on purpose — do not collapse them.
 *
 * THE WEEK READ IS WHERE LIVE AND FROZEN MONEY DIVERGE. `getWeekWithEarnings`
 * decides, once, on the server, whether a week's amount is computed now or
 * read from the snapshot frozen at approval — see its doc comment. No client
 * gets to make that call, and no client gets the raw snapshot columns to make
 * it with.
 *
 * THE EXPORT IS STRICTER THAN THE VIEW. `exportWeekCsv` serves the same week
 * as a payroll CSV and refuses everything `getWeekWithEarnings` merely
 * degrades: a screen may honestly show hours with no money, a file handed to a
 * payroll provider may not.
 *
 * @module domains/timesheet/services/timesheetQueryService
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type {
  TimesheetThread,
  TimesheetWeek,
  WeekEarningsStateResult,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  HOURS_ONLY_REASONS,
  type HoursOnlyReason,
  TIMESHEET_STATUSES,
  WEEK_EARNINGS_STATES,
  WeekEarningsSchema,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { logger } from '../../../middlewares/logger';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import { PayArrangementRepository } from '../../pay/repositories/payArrangementRepository';
// Concrete cross-domain imports, never the pay barrel — the same rule
// `paymentQueryService` follows importing this domain's repository.
import { PaymentRepository } from '../../pay/repositories/paymentRepository';
import {
  type NothingUnusualComputer,
  nothingUnusualService,
} from '../../pay/services/nothingUnusualService';
import {
  type WeekEarningsComputer,
  weekEarningsService,
} from '../../pay/services/weekEarningsService';
import type { PayArrangement } from '../../pay/types';
import { computePayPeriodEnd } from '../../pay/utils/payPeriod';
import { ShiftEventRepository } from '../../shift/repositories/shiftEventRepository';
import {
  PaySummaryExportError,
  TimeEntryNotFoundError,
  TimesheetNotExportableError,
  TimesheetNotFoundError,
} from '../errors/timesheetErrors';
import { TimeEntryRepository } from '../repositories/timeEntryRepository';
import {
  TimesheetRepository,
  type TimesheetRow,
} from '../repositories/timesheetRepository';
import type { TimeEntry, Timesheet } from '../types';
import {
  type CarerPaySummaryCsv,
  type CarerPaySummaryRow,
  renderCarerPaySummaryCsv,
} from '../utils/carerPaySummaryCsv';
import { toWireTimesheet } from '../utils/toWireTimesheet';
import {
  renderWeekExportCsv,
  type WeekExportCsv,
} from '../utils/weekExportCsv';
import {
  DEFAULT_WEEK_STARTS_ON,
  weekEndExclusive,
  weekEndInclusive,
  weekStartOf,
} from '../utils/weekStart';
import { toThreadMessages } from '../utils/weekThread';
import {
  renderYearEndSummaryCsv,
  type YearEndCarerRow,
  type YearEndSummaryCsv,
} from '../utils/yearEndSummaryCsv';

/** Roles that read the WHOLE household's payroll, active or removed. */
const PAYROLL_HOUSEHOLD_READ_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/**
 * What `assertPayrollReader` resolved: every carer's rows, or one carer's.
 * Same shape and same purpose as `expenseQueryService`'s `ReadScope`.
 */
type PayrollReadScope =
  | { kind: 'household' }
  | { kind: 'own'; carerId: string };

/**
 * The one thing this service needs from the pay domain's payments table: the
 * settlement ROWS for a week. Narrowed to a single method rather than taking
 * the repository type, so the dependency stays a read and stays injectable.
 *
 * The rows, not a bare total: D-20 requires the export to carry
 * every payment AND every correction as its own record, and to derive
 * `paid_to_date_minor` from the same array, so the summary can never disagree
 * with the rows a reader is checking it against.
 */
export interface WeekPaymentReader {
  listForTimesheet(timesheetId: string): Promise<Payment[]>;
}

/**
 * The one thing this service needs from the day thread: the rows on a date.
 * Narrowed to a single method for the same reason `WeekPaymentReader` is
 * — the dependency stays a read and stays injectable, and this service can
 * never grow a write into `shift_events` by accident.
 */
export interface DayThreadReader {
  listForHouseholdDate(
    householdId: string,
    localDate: string
  ): Promise<ShiftEvent[]>;
}

/**
 * The one thing `exportWeekCsv` needs from the pay domain's arrangements
 * table (082, D-29): the term effective on the week, read ONLY for its
 * `pay_frequency`/`pay_day_of_week`/`pay_day_of_month` fields — presentation
 * grouping, never a second pricing source. Narrowed to a single method for
 * the same reason `WeekPaymentReader`/`DayThreadReader` are: the dependency
 * stays a read and stays injectable.
 */
export interface PayArrangementReader {
  effectiveOn(
    householdId: string,
    carerId: string,
    date: string
  ): Promise<PayArrangement | null>;
}

export class TimesheetQueryService {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly earnings: WeekEarningsComputer = weekEarningsService,
    private readonly payments: WeekPaymentReader = new PaymentRepository(),
    // The week thread's store. Appended at the END so every existing caller
    // and test on the six-arg constructor keeps working unchanged.
    private readonly events: DayThreadReader = new ShiftEventRepository(),
    // 082/D-29's pay-period grouping. Appended at the END for the same
    // backward-compat reason `events` is.
    private readonly payArrangements: PayArrangementReader = new PayArrangementRepository(),
    // §11.1.1's fast-path judgement. Same append-at-the-end rule.
    private readonly nothingUnusual: NothingUnusualComputer = nothingUnusualService
  ) {}

  /** The caller's own open (running) entry, or null. No membership check — this is always the caller's own data. */
  async getRunning(carerId: string): Promise<TimeEntry | null> {
    return this.timeEntryRepo.findRunningForCarer(carerId);
  }

  /**
   * Fetch one time entry, enforcing that it belongs to the caller AND that the
   * caller is still an active member of the entry's household. Throws
   * TimeEntryNotFoundError for all three of "doesn't exist", "exists but isn't
   * yours", and "was yours but you've been removed" — the SAME error for each,
   * exactly like the household domain's `HouseholdNotFoundError` — so
   * existence is never leaked. This is the `lookup` the ownership middleware
   * calls on /time-entries/:id routes.
   *
   * Ownership alone is NOT the gate (F-B3b-3): this is what stands between a
   * `removed` nanny and `clockOut`/`updateEntry`, both of which rewrite hours
   * a household pays against. Same shape as `loadOwnedRow` below, and as
   * `timesheetCommandService.createRetroactiveEntry`, which has always
   * required an active membership.
   */
  async getOwnedTimeEntry(
    userId: string,
    timeEntryId: string
  ): Promise<TimeEntry> {
    const entry = await this.timeEntryRepo.findById(timeEntryId);
    if (!entry || entry.carer_id !== userId) {
      throw new TimeEntryNotFoundError(timeEntryId);
    }
    const membership = await this.memberRepo.findActiveMembership(
      entry.household_id,
      userId
    );
    if (!membership) {
      throw new TimeEntryNotFoundError(timeEntryId);
    }
    return entry;
  }

  /**
   * A household's entries for one week. `weekStart` defaults to the CURRENT
   * week, computed in the household's timezone (see `utils/weekStart.ts`) —
   * never UTC, or the boundary entries land on the wrong week.
   *
   * `carerId` narrows to ONE carer's hours. Optional and unfiltered by
   * default so the household-wide view keeps working, but any caller adding
   * these entries up must pass it: in a two-carer household the unscoped list
   * sums both nannies' minutes into one figure (F-B1-3). A removed nanny's
   * read overrides it with her own id — see `assertPayrollReader`.
   */
  async listForHouseholdWeek(
    userId: string,
    householdId: string,
    weekStart?: string,
    carerId?: string
  ): Promise<TimeEntry[]> {
    const scope = await this.assertPayrollReader(userId, householdId);
    const resolvedWeekStart =
      weekStart ?? (await this.currentWeekStart(householdId));
    return this.timeEntryRepo.listForHouseholdWeek(
      householdId,
      resolvedWeekStart,
      weekEndExclusive(resolvedWeekStart),
      scope.kind === 'own' ? scope.carerId : carerId
    );
  }

  /**
   * Fetch one timesheet, enforcing household membership. Throws
   * TimesheetNotFoundError for both "doesn't exist" and "exists but you're
   * not a member of its household" — the `lookup` the ownership middleware
   * calls on /timesheets/:id routes.
   */
  async getOwnedTimesheet(
    userId: string,
    timesheetId: string
  ): Promise<Timesheet> {
    return this.loadOwnedRow(userId, timesheetId);
  }

  /**
   * Fetch one timesheet for READING. Same load as `loadOwnedRow`, but gated
   * by `assertPayrollReader` instead of an active membership, so a member
   * removed from the household can still open the week she worked (or, as a
   * departed parent, the week she paid for). A removed nanny additionally has
   * to own the row.
   *
   * This gates `GET /timesheets/:id` (via `getWeekWithEarnings`) and nothing
   * else. Every ACTION on a timesheet — approve, query, reopen — keeps
   * `getOwnedTimesheet`: reading a signed week and signing one are not the
   * same permission, and a removed parent must not be able to approve.
   *
   * Do NOT wire this into `makeOwnershipValidator` on the read route to
   * "match" the actions. That validator caches by `(userId, resourceId)` with
   * no lookup identity, so a permitted read would leave a positive entry the
   * ACTIONS then reuse — the wider gate silently replacing the stricter one
   * on the same id. See `routes/timesheetRoutes.ts` and its route test.
   */
  async getReadableTimesheet(
    userId: string,
    timesheetId: string
  ): Promise<TimesheetRow> {
    const timesheet = await this.timesheetRepo.findById(timesheetId);
    if (!timesheet) {
      throw new TimesheetNotFoundError(timesheetId);
    }
    // EVERY denial past this point must be byte-identical to the "no such
    // row" throw above, metadata included: `toClientJSON` serialises
    // `metadata` for any sub-500 status, so letting the gate's richer
    // `reason` reach the wire here would tell a stranger which timesheet ids
    // are real. The gate keeps that reason for the household-scoped LIST
    // reads, where the caller supplied the household id and there is nothing
    // to leak. A non-NotFound failure (a dead database) is rethrown as-is —
    // collapsing that into a 404 would hide an outage.
    const scope = await this.assertPayrollReader(
      userId,
      timesheet.household_id
    ).catch((error: unknown) => {
      if (error instanceof TimesheetNotFoundError) {
        throw new TimesheetNotFoundError(timesheetId);
      }
      throw error;
    });
    if (scope.kind === 'own' && timesheet.carer_id !== scope.carerId) {
      throw new TimesheetNotFoundError(timesheetId);
    }
    return timesheet;
  }

  /**
   * A household's timesheets, most recent week first. Caller must be a
   * member — active, or removed with a payroll read scope
   * (`assertPayrollReader`).
   *
   * Deliberately NOT earnings-bearing: pricing every week in a household's
   * whole history on every list read would be several queries per row, and
   * the list is a navigation surface, not a pay statement. A caller that
   * wants a figure asks for the one week it is showing
   * (`getWeekWithEarnings`) — which is also the only path with the
   * legacy/corrupt handling. The raw snapshot columns are stripped here for
   * that exact reason.
   *
   * `carerId` narrows to ONE carer. A caller resolving "the row for this
   * week" out of the unscoped list picks by week alone and binds to whichever
   * carer's row sorted first — see F-B1-3; the pair that identifies a
   * timesheet is `(household_id, carer_id, week_start)`, never the week alone.
   */
  async listTimesheetsForHousehold(
    userId: string,
    householdId: string,
    carerId?: string
  ): Promise<Timesheet[]> {
    const scope = await this.assertPayrollReader(userId, householdId);
    const rows = await this.timesheetRepo.listForHousehold(
      householdId,
      scope.kind === 'own' ? scope.carerId : carerId
    );
    return rows.map(row => toWireTimesheet(row));
  }

  /**
   * THE WEEK READ: one timesheet with its earnings attached, live or frozen.
   *
   * The decision, in full (`docs/11-MONEY.md` §3, TIER0-PLAN.md Phase 2):
   *
   * - **No carer** (`carer_id` NULL — she deleted her ACCOUNT, and 033 kept
   *   the household's payroll record). Nothing to resolve an arrangement
   *   against, so hours-only with `carer_removed`. Deliberately not the
   *   "set a pay rate" nudge: the command service requires an active member
   *   to write an arrangement, so that CTA could never succeed (§4). Note
   *   this branch keys on a NULL carer_id, NOT on membership status: a nanny
   *   REMOVED from the household keeps her carer_id, so her weeks keep
   *   pricing normally (live or frozen) and she can still read them.
   * - **Not approved** (`open`/`submitted`/`queried`). Computed fresh, every
   *   read, from the entries and the arrangements effective on their dates.
   *   Nothing is written — a read that wrote a snapshot would freeze a figure
   *   nobody had approved.
   * - **Approved with a snapshot.** The snapshot, parsed back through
   *   `WeekEarningsSchema`, never recomputed. A backdated raise recomputes an
   *   open week and leaves a signed one alone; that asymmetry is the entire
   *   value of freezing.
   * - **Approved with a NULL snapshot** — a week approved before migration
   *   042, never backfilled. Hours-only, forever. A live number under an
   *   "Approved" label would silently show today's terms standing in for
   *   whatever was actually agreed (review finding 5).
   * - **Approved with unparseable jsonb.** Hours-only as well, tagged
   *   `unreadable_snapshot`. The alternatives are both worse: recomputing
   *   would print a live number under "Approved" (the same defect), and
   *   throwing would blank the screen a nanny opened specifically to see what
   *   she is owed.
   *
   * Note the shape of that list: a live figure is reachable from exactly ONE
   * branch, and it is the branch where the week is not approved.
   */
  async getWeekWithEarnings(
    userId: string,
    timesheetId: string
  ): Promise<TimesheetWeek> {
    const row = await this.getReadableTimesheet(userId, timesheetId);
    const earnings = await this.earningsFor(row);
    return {
      ...toWireTimesheet(row),
      earnings,
      nothing_unusual: await this.nothingUnusualFor(row, earnings),
    };
  }

  /**
   * D-5 / §11.1.1 — `null` outside the `ok` earnings state (no arrangement,
   * no carer, hours-only, currency-change): there is nothing to judge as
   * "usual" when there is no priced structure to compare in the first
   * place. A live judgement, computed fresh on every read next to the
   * engine — never stored, never part of the frozen snapshot (see the wire
   * schema's own doc comment on why).
   */
  private async nothingUnusualFor(
    row: TimesheetRow,
    earnings: WeekEarningsStateResult
  ): Promise<boolean | null> {
    if (earnings.status !== WEEK_EARNINGS_STATES.OK || !row.carer_id) {
      return null;
    }
    return this.nothingUnusual.computeForWeek(
      row.household_id,
      row.carer_id,
      row.week_start,
      row.status,
      earnings
    );
  }

  /**
   * THE WEEK THREAD: what was SAID about a week, both sides, oldest first
   * (D-18, gap P1 — `docs/design/attention-and-notifications.md` §3).
   *
   * READ GATE: `getReadableTimesheet`, byte-identical to the week read's and
   * DELIBERATELY the wider of the two gates in this service. The whole of P1
   * is that the nanny could not read what a parent said about her pay;
   * handing this the ACTION gate (`getOwnedTimesheet`) would let a departed
   * nanny read the hours she worked but not the dispute about them, which is
   * the same defect wearing a different hat. Same argument as the export.
   *
   * Do NOT wire this into `makeOwnershipValidator` on the route — see
   * `getReadableTimesheet`'s doc and GOLDEN-FIXES #32. One permitted thread
   * read would leave a positive `(userId, resourceId)` cache entry that
   * `/approve` then reuses.
   *
   * Returns `{ messages: [] }` for a clean week rather than throwing: on the
   * ~50 quiet weeks a year there is genuinely nothing to say, and the client
   * renders nothing at all (D16).
   */
  async getThread(
    userId: string,
    timesheetId: string
  ): Promise<TimesheetThread> {
    const row = await this.getReadableTimesheet(userId, timesheetId);
    const [events, household] = await Promise.all([
      this.events.listForHouseholdDate(row.household_id, row.week_start),
      this.householdRepo.findById(row.household_id),
    ]);
    return {
      messages: toThreadMessages(events, {
        timesheetId: row.id,
        carerId: row.carer_id,
        carerName: row.carer_display_name,
        householdName: household?.name,
      }),
    };
  }

  /**
   * THE PAYROLL HANDOFF: one APPROVED week, serialised to CSV for HomePay /
   * Nannytax / an accountant. The app's whole tax position is "we compute,
   * your payroll provider files" (AGENCY-ROADMAP Tier 1.2), and this is the
   * artifact that makes that sentence true.
   *
   * READ GATE: `getReadableTimesheet` — byte-identical to the week read's, on
   * purpose. A carer needs her OWN export (it is the record of what she is
   * owed), and a carer removed from the household keeps it for exactly as long
   * as she keeps the week read, by the same argument
   * (`assertPayrollReader`: payroll is an audit trail). There is no new gate
   * here to drift from that one.
   *
   * WHAT IT REFUSES, and why the refusals are stricter than the SCREEN's:
   * `getWeekWithEarnings` degrades a week it cannot price into `hours_only`
   * rather than blanking the display. A FILE cannot degrade — it is forwarded,
   * filed and paid against long after any on-screen caveat is gone — so every
   * state that is not a readable FROZEN snapshot is a refusal here
   * (`TimesheetNotExportableError`, 409): a week that is not `approved` (its
   * amount is still live), a pre-042 legacy approval, an unreadable snapshot,
   * a carer who deleted her account.
   *
   * NOTHING IS RECOMPUTED. The status check happens BEFORE `earningsFor`, so
   * the only branch this can reach in there is the frozen-snapshot one — a
   * live estimate can never end up in an exported file.
   *
   * The settlement ROWS come from the payments table, and `paid_to_date_minor`
   * is derived from them (D-20): a correction and the payment it reverses BOTH
   * ship, never netted, because the export is what a payroll service and a
   * dispute both read. Note this discloses the settlement history to whoever
   * the week read already shows the frozen gross to — which, since D-21, is
   * parents/owner plus the week's OWN carer, exactly `paymentQueryService`'s
   * own gate. The two audiences used to differ and no longer do.
   */
  async exportWeekCsv(
    userId: string,
    timesheetId: string
  ): Promise<WeekExportCsv> {
    const row = await this.getReadableTimesheet(userId, timesheetId);
    if (row.status !== TIMESHEET_STATUSES.APPROVED) {
      throw new TimesheetNotExportableError(
        timesheetId,
        row.status,
        'not_approved'
      );
    }
    const earnings = await this.earningsFor(row);
    if (earnings.status !== WEEK_EARNINGS_STATES.OK) {
      throw new TimesheetNotExportableError(
        timesheetId,
        row.status,
        earnings.status === WEEK_EARNINGS_STATES.HOURS_ONLY
          ? earnings.reason
          : earnings.status
      );
    }
    // 082/D-29: period-end + household identifier, both PRESENTATION ONLY.
    // Neither read here can fail the export — a household row always exists
    // for a readable timesheet, and a missing/unpriced-schedule arrangement
    // just means the two new fields are omitted (`renderWeekExportCsv`'s own
    // discipline), never that the export itself refuses.
    const [household, arrangement] = await Promise.all([
      this.householdRepo.findById(row.household_id),
      row.carer_id
        ? this.payArrangements.effectiveOn(
            row.household_id,
            row.carer_id,
            weekEndInclusive(row.week_start)
          )
        : Promise.resolve(null),
    ]);
    const periodEnd = arrangement
      ? computePayPeriodEnd({
          weekStart: row.week_start,
          weekEnd: weekEndInclusive(row.week_start),
          payFrequency: arrangement.pay_frequency ?? null,
          payDayOfMonth: arrangement.pay_day_of_month ?? null,
          arrangementValidFrom: arrangement.valid_from,
          weekStartsOn: household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON,
        })
      : null;
    return renderWeekExportCsv({
      timesheet: toWireTimesheet(row),
      earnings,
      payments: await this.payments.listForTimesheet(timesheetId),
      periodEnd,
      householdDisplayName: household?.name || null,
    });
  }

  /**
   * THE NANNY'S OWN PAY RECORD (D-29, P11, `docs/design/
   * screens-pay-terms.md` §12.1) — her weeks, gross, and a YTD total over a
   * date range. "Generated by her, from My pay, without asking anyone."
   *
   * READ GATE: `assertPayrollReader`, the SAME carer-scoped read model 3-T2
   * built for every other payroll surface — a nanny caller is FORCED to her
   * own `carerId`, exactly like `listForHouseholdWeek`/
   * `listTimesheetsForHousehold`; a supplied `params.carerId` is ignored for
   * her, never trusted. A parent (household scope) MUST name a carer —
   * there is no "everyone's summary in one file" here, only the year-end
   * total below has that shape.
   *
   * EXPORT DISCIPLINE, extended for a MULTI-week surface: a single week's
   * export REFUSES the whole request when the week is not a frozen
   * `approved` snapshot (`exportWeekCsv`). A range spans many weeks, most of
   * which are legitimately still open on any given day, so refusing the
   * whole range for that reason would make this export unusable in
   * practice. Instead, each week is checked individually and a
   * non-exportable one is EXCLUDED from the range — never estimated, never
   * counted, simply absent from the rows and the YTD sum. This is still
   * "frozen snapshots only": every row that DOES appear is exactly as
   * approved, nothing is recomputed.
   *
   * CURRENCY: refused, never blended (`PaySummaryExportError`,
   * `mixed_currency`) if the included weeks price in more than one — the
   * same `docs/11-MONEY.md` §6 rule the earnings engine applies to a single
   * week, extended to a range.
   */
  async exportCarerPaySummaryCsv(
    userId: string,
    householdId: string,
    params: { carerId?: string; from: string; to: string }
  ): Promise<CarerPaySummaryCsv> {
    const scope = await this.assertPayrollReader(userId, householdId);
    const carerId = scope.kind === 'own' ? scope.carerId : params.carerId;
    if (!carerId) {
      throw new PaySummaryExportError('carer_required', { householdId });
    }
    const household = await this.householdRepo.findById(householdId);
    const rows = await this.timesheetRepo.listForHousehold(
      householdId,
      carerId
    );
    const {
      rows: included,
      carerDisplayName,
      currency,
    } = await this.exportableRowsInRange(rows, params.from, params.to);
    if (currency === undefined) {
      throw new PaySummaryExportError('mixed_currency', {
        householdId,
        carerId,
      });
    }
    included.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    return renderCarerPaySummaryCsv({
      carerDisplayName: carerDisplayName ?? 'Carer',
      householdDisplayName: household?.name || null,
      currency: currency ?? household?.currency ?? 'USD',
      rangeStart: params.from,
      rangeEnd: params.to,
      rows: included,
    });
  }

  /**
   * THE PARENT'S YEAR-END PAYROLL HANDOFF (D-29, P12, `docs/design/
   * screens-pay-terms.md` §12.2) — "calendar-year sum of approved gross +
   * reimbursements split out" for the FSA / Form 2441 job, one row per
   * carer. READ GATE: `assertPayrollReader` — a nanny caller is forced to
   * her own row only (the same fairness rule as every other read here), a
   * parent sees the whole household.
   *
   * Same exclude-don't-refuse-the-range discipline as
   * `exportCarerPaySummaryCsv`, and the same refuse-don't-blend currency
   * rule, applied across the WHOLE household this time (a household with
   * two carers paid in different currencies cannot be honestly totalled).
   */
  async exportYearEndSummaryCsv(
    userId: string,
    householdId: string,
    year: number
  ): Promise<YearEndSummaryCsv> {
    const scope = await this.assertPayrollReader(userId, householdId);
    const household = await this.householdRepo.findById(householdId);
    const rows = await this.timesheetRepo.listForHousehold(
      householdId,
      scope.kind === 'own' ? scope.carerId : undefined
    );
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;

    const byCarer = new Map<
      string,
      { name: string; gross: number; reimb: number; weeks: number }
    >();
    const currencies = new Set<string>();
    for (const row of rows) {
      if (!row.carer_id) continue;
      if (row.week_start < from || row.week_start > to) continue;
      if (row.status !== TIMESHEET_STATUSES.APPROVED) continue;
      const earnings = await this.earningsFor(row);
      if (earnings.status !== WEEK_EARNINGS_STATES.OK) continue;
      currencies.add(earnings.currency);
      const entry = byCarer.get(row.carer_id) ?? {
        name: row.carer_display_name ?? 'Carer',
        gross: 0,
        reimb: 0,
        weeks: 0,
      };
      entry.gross += earnings.gross_minor;
      entry.reimb += earnings.reimbursements_minor;
      entry.weeks += 1;
      byCarer.set(row.carer_id, entry);
    }
    if (currencies.size > 1) {
      throw new PaySummaryExportError('mixed_currency', {
        householdId,
        year,
      });
    }
    const currency = [...currencies][0] ?? household?.currency ?? 'USD';
    const carerRows: YearEndCarerRow[] = [...byCarer.values()].map(e => ({
      carerDisplayName: e.name,
      grossMinor: e.gross,
      reimbursementsMinor: e.reimb,
      weeksIncluded: e.weeks,
    }));
    return renderYearEndSummaryCsv({
      householdDisplayName: household?.name || null,
      currency,
      year,
      rows: carerRows,
    });
  }

  /**
   * Shared by `exportCarerPaySummaryCsv`: filters one carer's rows to a date
   * range and to exportable (approved + `ok` snapshot) weeks, deriving the
   * carer's display name and the range's currency along the way. `currency`
   * is `undefined` on a MIXED-currency range (the caller refuses), `null`
   * when there are no included rows at all to have an opinion about.
   */
  private async exportableRowsInRange(
    rows: readonly TimesheetRow[],
    from: string,
    to: string
  ): Promise<{
    rows: CarerPaySummaryRow[];
    carerDisplayName: string | null;
    currency: string | undefined | null;
  }> {
    const included: CarerPaySummaryRow[] = [];
    let carerDisplayName: string | null = null;
    const currencies = new Set<string>();
    for (const row of rows) {
      if (row.week_start < from || row.week_start > to) continue;
      if (row.status !== TIMESHEET_STATUSES.APPROVED) continue;
      const earnings = await this.earningsFor(row);
      if (earnings.status !== WEEK_EARNINGS_STATES.OK) continue;
      carerDisplayName = row.carer_display_name ?? carerDisplayName;
      currencies.add(earnings.currency);
      included.push({
        weekStart: row.week_start,
        weekEnd: weekEndInclusive(row.week_start),
        approvedAt: row.approved_at ?? '',
        grossMinor: earnings.gross_minor,
        reimbursementsMinor: earnings.reimbursements_minor,
      });
    }
    return {
      rows: included,
      carerDisplayName,
      currency: currencies.size > 1 ? undefined : ([...currencies][0] ?? null),
    };
  }

  /** The earnings state for one row — the live/frozen decision, and nothing else. */
  private async earningsFor(
    row: TimesheetRow
  ): Promise<WeekEarningsStateResult> {
    if (!row.carer_id) {
      return this.hoursOnly(row, HOURS_ONLY_REASONS.CARER_REMOVED);
    }
    if (row.status !== TIMESHEET_STATUSES.APPROVED) {
      return this.earnings.computeForWeek(
        row.household_id,
        row.carer_id,
        row.week_start
      );
    }
    if (row.earnings === null || row.earnings === undefined) {
      return this.hoursOnly(row, HOURS_ONLY_REASONS.LEGACY_APPROVAL);
    }
    const parsed = WeekEarningsSchema.safeParse(row.earnings);
    if (parsed.success) {
      return parsed.data;
    }
    // Hours-only is the right thing to RENDER — the alternatives blank the
    // screen or print a live number under an Approved label — but on screen
    // it is indistinguishable from a legacy approval, so on its own it
    // degrades the week silently and permanently. Say so where someone will
    // see it: error level auto-forwards to Sentry via the transport.
    logger.error('Frozen earnings snapshot unreadable', {
      timesheetId: row.id,
      householdId: row.household_id,
      weekStart: row.week_start,
      issues: parsed.error.issues.map(issue => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    });
    return this.hoursOnly(row, HOURS_ONLY_REASONS.UNREADABLE_SNAPSHOT);
  }

  private hoursOnly(
    row: TimesheetRow,
    reason: HoursOnlyReason
  ): WeekEarningsStateResult {
    return {
      status: WEEK_EARNINGS_STATES.HOURS_ONLY,
      week_start: row.week_start,
      reason,
    };
  }

  /** Shared load + membership gate for every by-id timesheet read. */
  private async loadOwnedRow(
    userId: string,
    timesheetId: string
  ): Promise<TimesheetRow> {
    const timesheet = await this.timesheetRepo.findById(timesheetId);
    if (!timesheet) {
      throw new TimesheetNotFoundError(timesheetId);
    }
    const membership = await this.memberRepo.findActiveMembership(
      timesheet.household_id,
      userId
    );
    if (!membership) {
      throw new TimesheetNotFoundError(timesheetId);
    }
    return timesheet;
  }

  /**
   * The first day of the household's own workweek, in the household's
   * timezone, for the week containing "now". BOTH halves come off the
   * household row (§5 D-8); the `??`s fire only when it fails to load.
   */
  private async currentWeekStart(householdId: string): Promise<string> {
    const household = await this.householdRepo.findById(householdId);
    return weekStartOf(
      new Date(),
      household?.timezone ?? 'UTC',
      household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON
    );
  }

  /**
   * THE PAYROLL READ GATE, shared by every read above.
   *
   * | caller                       | scope                           |
   * |------------------------------|---------------------------------|
   * | `owner`/`parent`, ANY status | household — they paid the money |
   * | `nanny`, ANY status          | her OWN carer rows, FORCED      |
   * | `helper`, ANY status         | not found                       |
   * | non-member                   | not found                       |
   *
   * ROLE DECIDES THE SCOPE; STATUS DECIDES NOTHING (D-21, gaps P4/P8 —
   * migration 087 moves the RLS half in the same commit). This gate used to
   * short-circuit on `status === 'active'` BEFORE it looked at the role, which
   * meant every active member read the whole household's payroll: a
   * `timesheets` row carries `gross_minor` and the frozen `earnings` snapshot,
   * and `time_entries` carries exact clock-in times, break lengths and shift
   * notes. So a HELPER — someone brought in for the school run — and a SECOND
   * NANNY could both read another carer's pay through `GET /timesheets/:id`,
   * the household list, and the CSV export. One screenshot of that in a nanny
   * Facebook group is an extinction event for a product whose whole
   * proposition is that both sides trust the record.
   *
   * The table above is now the SAME one every other money read in this repo
   * already had — `paymentQueryService.assertPaymentReader`,
   * `expenseQueryService.assertCanRead`, `payArrangementQueryService`. That is
   * the point: the two hours tables were the exception, and they no longer
   * are. If you change one of the four, change all four.
   *
   * STATUS IS NOT PART OF THE TABLE, and that is deliberate in BOTH
   * directions. A nanny who has left must still see the hours she worked and
   * the pay she was owed, and the parents who paid keep the household view —
   * payroll is an audit trail, not a live surface that disappears with the
   * badge (067's row-armed `carer_id = auth.uid()` policy makes the same
   * argument in SQL). Everything else about a removed member stays shut: the
   * write gates (`loadOwnedRow`, `getOwnedTimeEntry`) still resolve an ACTIVE
   * membership, so she can read her week and change nothing in it — and
   * neither can a removed parent approve one. That is what keeps F-B3b-3
   * closed, and it is why `HOUSEHOLD_MEMBER_STATUSES` is no longer read here.
   *
   * The `own` scope is FORCED, never merely offered: `listForHouseholdWeek`
   * and `listTimesheetsForHousehold` take a client-supplied `carerId` filter,
   * and a nanny handed carer-2's id would otherwise read carer-2's hours by
   * asking for them. Same enforcement point as
   * `expenseQueryService.scopeRows`. `getReadableTimesheet` applies the same
   * scope row-wise and 404s on a mismatch.
   */
  private async assertPayrollReader(
    userId: string,
    householdId: string
  ): Promise<PayrollReadScope> {
    const membership = await this.memberRepo.findMembershipAnyStatus(
      householdId,
      userId
    );
    if (!membership) {
      throw new TimesheetNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
    if (PAYROLL_HOUSEHOLD_READ_ROLES.has(membership.role)) {
      return { kind: 'household' };
    }
    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      return { kind: 'own', carerId: userId };
    }
    // A helper, active or removed — no payroll surface, ever.
    throw new TimesheetNotFoundError(householdId, {
      reason: 'household_not_accessible',
    });
  }
}

// Singleton for controllers/routes that don't need DI.
export const timesheetQueryService = new TimesheetQueryService();
