/**
 * Timesheet query service (CQRS-lite: reads only). Two different ownership
 * shapes live here: a time entry belongs to a CARER (checked by
 * `carer_id === userId`, not household membership — a nanny's own clock
 * history is hers alone to read), while a household-scoped list or a
 * timesheet is gated by MEMBERSHIP, exactly like the household/schedule/
 * shift domains — see `../../household`, imported READ-ONLY for
 * `HouseholdMemberRepository`/`HouseholdRepository`.
 *
 * THE WEEK READ IS WHERE LIVE AND FROZEN MONEY DIVERGE. `getWeekWithEarnings`
 * decides, once, on the server, whether a week's amount is computed now or
 * read from the snapshot frozen at approval — see its doc comment. No client
 * gets to make that call, and no client gets the raw snapshot columns to make
 * it with.
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
import {
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import {
  type WeekEarningsComputer,
  weekEarningsService,
} from '../../pay/services/weekEarningsService';
import {
  TimeEntryNotFoundError,
  TimesheetNotFoundError,
} from '../errors/timesheetErrors';
import { TimeEntryRepository } from '../repositories/timeEntryRepository';
import {
  TimesheetRepository,
  type TimesheetRow,
} from '../repositories/timesheetRepository';
import type { TimeEntry, Timesheet } from '../types';
import { toWireTimesheet } from '../utils/toWireTimesheet';
import { weekEndExclusive, weekStartOf } from '../utils/weekStart';

export class TimesheetQueryService {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly earnings: WeekEarningsComputer = weekEarningsService
  ) {}

  /** The caller's own open (running) entry, or null. No membership check — this is always the caller's own data. */
  async getRunning(carerId: string): Promise<TimeEntry | null> {
    return this.timeEntryRepo.findRunningForCarer(carerId);
  }

  /**
   * Fetch one time entry, enforcing that it belongs to the caller. Throws
   * TimeEntryNotFoundError for both "doesn't exist" and "exists but isn't
   * yours" — the SAME error for both, exactly like the household domain's
   * `HouseholdNotFoundError` — so existence is never leaked. This is the
   * `lookup` the ownership middleware calls on /time-entries/:id routes.
   */
  async getOwnedTimeEntry(
    userId: string,
    timeEntryId: string
  ): Promise<TimeEntry> {
    const entry = await this.timeEntryRepo.findById(timeEntryId);
    if (!entry || entry.carer_id !== userId) {
      throw new TimeEntryNotFoundError(timeEntryId);
    }
    return entry;
  }

  /**
   * A household's entries for one week. `weekStart` defaults to the CURRENT
   * week, computed in the household's timezone (see `utils/weekStart.ts`) —
   * never UTC, or the boundary entries land on the wrong week.
   */
  async listForHouseholdWeek(
    userId: string,
    householdId: string,
    weekStart?: string
  ): Promise<TimeEntry[]> {
    await this.assertMember(userId, householdId);
    const resolvedWeekStart =
      weekStart ?? (await this.currentWeekStart(householdId));
    return this.timeEntryRepo.listForHouseholdWeek(
      householdId,
      resolvedWeekStart,
      weekEndExclusive(resolvedWeekStart)
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
   * A household's timesheets, most recent week first. Caller must be an
   * active member.
   *
   * Deliberately NOT earnings-bearing: pricing every week in a household's
   * whole history on every list read would be several queries per row, and
   * the list is a navigation surface, not a pay statement. A caller that
   * wants a figure asks for the one week it is showing
   * (`getWeekWithEarnings`) — which is also the only path with the
   * legacy/corrupt handling. The raw snapshot columns are stripped here for
   * that exact reason.
   */
  async listTimesheetsForHousehold(
    userId: string,
    householdId: string
  ): Promise<Timesheet[]> {
    await this.assertMember(userId, householdId);
    const rows = await this.timesheetRepo.listForHousehold(householdId);
    return rows.map(row => toWireTimesheet(row));
  }

  /**
   * THE WEEK READ: one timesheet with its earnings attached, live or frozen.
   *
   * The decision, in full (`docs/11-MONEY.md` §3, TIER0-PLAN.md Phase 2):
   *
   * - **No carer** (`carer_id` NULL — she deleted her account, and 033 kept
   *   the household's payroll record). Nothing to resolve an arrangement
   *   against, so hours-only with `carer_removed`. Deliberately not the
   *   "set a pay rate" nudge: the command service requires an active member
   *   to write an arrangement, so that CTA could never succeed (§4).
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
    const row = await this.loadOwnedRow(userId, timesheetId);
    return {
      ...toWireTimesheet(row),
      earnings: await this.earningsFor(row),
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
    return parsed.success
      ? parsed.data
      : this.hoursOnly(row, HOURS_ONLY_REASONS.UNREADABLE_SNAPSHOT);
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

  /** Membership check shared by every household-scoped read above. */
  private async assertMember(
    userId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new TimesheetNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const timesheetQueryService = new TimesheetQueryService();
