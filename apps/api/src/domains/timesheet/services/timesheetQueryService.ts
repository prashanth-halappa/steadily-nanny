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
 * `assertPayrollReader` (reads) accepts a `removed` member with her role's
 * scope, because payroll is an audit trail; `loadOwnedRow`/`getOwnedTimeEntry`
 * (the lookups behind every ACTION) still require an ACTIVE membership, which
 * is what keeps F-B3b-3 closed. `getOwnedTimesheet` and `getReadableTimesheet`
 * load the same row through those two different gates on purpose — do not
 * collapse them.
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
import type {
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
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
// Concrete cross-domain import, never the pay barrel — the same rule
// `paymentQueryService` follows importing this domain's repository.
import { PaymentRepository } from '../../pay/repositories/paymentRepository';
import {
  type WeekEarningsComputer,
  weekEarningsService,
} from '../../pay/services/weekEarningsService';
import {
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
import { toWireTimesheet } from '../utils/toWireTimesheet';
import {
  renderWeekExportCsv,
  type WeekExportCsv,
} from '../utils/weekExportCsv';
import { weekEndExclusive, weekStartOf } from '../utils/weekStart';

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
 * The one thing this service needs from the pay domain's payments table: what
 * a week has been settled for. Narrowed to a single method rather than taking
 * the repository type, so the dependency stays a read and stays injectable.
 */
export interface WeekPaymentTotalReader {
  sumForTimesheet(timesheetId: string): Promise<number>;
}

export class TimesheetQueryService {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly earnings: WeekEarningsComputer = weekEarningsService,
    private readonly payments: WeekPaymentTotalReader = new PaymentRepository()
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
    return {
      ...toWireTimesheet(row),
      earnings: await this.earningsFor(row),
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
   * `paid_to_date_minor` comes from the payments table. Note this discloses a
   * settlement total to any active member the week read already shows the
   * frozen gross to — a wider audience than `paymentQueryService`'s own gate
   * (parents + the week's own carer). That is deliberate and bounded: the
   * export is the same artifact as the week read, in a different container,
   * and giving it a second, narrower gate would mean a carer or parent could
   * see a figure on screen that her own download silently omits.
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
    return renderWeekExportCsv({
      timesheet: toWireTimesheet(row),
      earnings,
      paidToDateMinor: await this.payments.sumForTimesheet(timesheetId),
    });
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

  /** The Monday, in the household's timezone, of the week containing "now". */
  private async currentWeekStart(householdId: string): Promise<string> {
    const household = await this.householdRepo.findById(householdId);
    return weekStartOf(new Date(), household?.timezone ?? 'UTC');
  }

  /**
   * THE PAYROLL READ GATE, shared by every read above — and the ONLY gate in
   * this service that accepts a `removed` membership.
   *
   * | caller                        | scope                          |
   * |-------------------------------|--------------------------------|
   * | any ACTIVE member, any role   | household (today's behaviour)  |
   * | removed `owner`/`parent`      | household — they paid the money|
   * | removed `nanny`               | her OWN carer rows, forced     |
   * | removed `helper`, non-member  | not found                      |
   *
   * A nanny who has left must still be able to see the hours she worked and
   * the pay she was owed; payroll is an audit trail, not a live surface that
   * disappears with the badge. Everything else about a removed member stays
   * shut: the write gates below (`loadOwnedRow`, `getOwnedTimeEntry`) still
   * resolve an ACTIVE membership, so she can read her week and change nothing
   * in it — and neither can a removed parent approve one.
   *
   * The `own` scope is FORCED, never merely offered: `listForHouseholdWeek`
   * and `listTimesheetsForHousehold` take a client-supplied `carerId` filter,
   * and a removed nanny handed carer-2's id would otherwise read carer-2's
   * hours. Same enforcement point as `expenseQueryService.scopeRows`.
   *
   * ponytail: API contract only — nothing in the mobile app can reach these
   * routes for a removed member yet, because `GET /households` lists
   * ACTIVE memberships (`listActiveByUser`) and a removed member's household
   * vanishes from it. The upgrade path is a past-households listing; the gate
   * is deliberately landed first so the client has something correct to
   * call when it exists.
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
    if (membership.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE) {
      return { kind: 'household' };
    }
    if (PAYROLL_HOUSEHOLD_READ_ROLES.has(membership.role)) {
      return { kind: 'household' };
    }
    if (membership.role === HOUSEHOLD_ROLES.NANNY) {
      return { kind: 'own', carerId: userId };
    }
    // A removed helper — she never had a payroll surface to keep.
    throw new TimesheetNotFoundError(householdId, {
      reason: 'household_not_accessible',
    });
  }
}

// Singleton for controllers/routes that don't need DI.
export const timesheetQueryService = new TimesheetQueryService();
