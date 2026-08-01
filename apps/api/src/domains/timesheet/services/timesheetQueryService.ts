/**
 * Timesheet query service (CQRS-lite: reads only). Two different ownership
 * shapes live here: a time entry belongs to a CARER (checked by
 * `carer_id === userId`, not household membership — a nanny's own clock
 * history is hers alone to read), while a household-scoped list or a
 * timesheet is gated by MEMBERSHIP, exactly like the household/schedule/
 * shift domains — see `../../household`, imported READ-ONLY for
 * `HouseholdMemberRepository`/`HouseholdRepository`.
 *
 * @module domains/timesheet/services/timesheetQueryService
 */
import {
  HouseholdMemberRepository,
  HouseholdRepository,
} from '../../household';
import {
  TimeEntryNotFoundError,
  TimesheetNotFoundError,
} from '../errors/timesheetErrors';
import { TimeEntryRepository } from '../repositories/timeEntryRepository';
import { TimesheetRepository } from '../repositories/timesheetRepository';
import type { TimeEntry, Timesheet } from '../types';
import { weekStartOf } from '../utils/weekStart';

const DAYS_PER_WEEK = 7;

/** The exclusive end of the week starting `weekStart` ('YYYY-MM-DD'). */
function weekEndExclusive(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start.getTime() + DAYS_PER_WEEK * 24 * 60 * 60 * 1000);
  return end.toISOString().slice(0, 10);
}

export class TimesheetQueryService {
  constructor(
    private readonly timeEntryRepo: TimeEntryRepository = new TimeEntryRepository(),
    private readonly timesheetRepo: TimesheetRepository = new TimesheetRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository()
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

  /** A household's timesheets, most recent week first. Caller must be an active member. */
  async listTimesheetsForHousehold(
    userId: string,
    householdId: string
  ): Promise<Timesheet[]> {
    await this.assertMember(userId, householdId);
    return this.timesheetRepo.listForHousehold(householdId);
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
