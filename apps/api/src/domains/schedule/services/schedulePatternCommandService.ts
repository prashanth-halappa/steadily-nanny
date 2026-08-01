/**
 * Schedule-pattern command service (CQRS-lite: writes). Role checks live at
 * the top of each method, copied from the household domain's convention:
 * parents write schedules, nannies (the assigned carer) only respond.
 *
 * `respond`'s accept branch is where a pattern turns into real shift rows —
 * see `scheduleMaterialisationService`, injected here rather than
 * constructed inline so tests can inject a fake and never touch Supabase.
 *
 * @module domains/schedule/services/schedulePatternCommandService
 */

import type { HouseholdMember } from '../../household';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import {
  NotThePatternCarerError,
  PatternMissingCarerError,
  PatternNotDraftError,
  PatternNotEditableError,
  PatternNotPendingError,
} from '../errors/scheduleErrors';
import { SchedulePatternDayChildRepository } from '../repositories/schedulePatternDayChildRepository';
import { SchedulePatternDayRepository } from '../repositories/schedulePatternDayRepository';
import { SchedulePatternRepository } from '../repositories/schedulePatternRepository';
import type {
  CreateSchedulePatternInput,
  ReplaceSchedulePatternDaysInput,
  RespondToSchedulePatternInput,
  SchedulePattern,
  UpdateSchedulePatternInput,
} from '../types';
import { expandRecurrence } from './recurrenceExpander';
import {
  type ScheduleMaterialisationService,
  scheduleMaterialisationService,
} from './scheduleMaterialisationService';
import {
  type SchedulePatternQueryService,
  schedulePatternQueryService,
} from './schedulePatternQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/** How far ahead of "now" a pattern is materialised on acceptance, when it has no `until`. A later re-run (a scheduled job, not built here) would roll this window forward. */
const DEFAULT_MATERIALISATION_HORIZON_DAYS = 84; // 12 weeks

export class SchedulePatternCommandService {
  constructor(
    private readonly patternRepo: SchedulePatternRepository = new SchedulePatternRepository(),
    private readonly dayRepo: SchedulePatternDayRepository = new SchedulePatternDayRepository(),
    private readonly dayChildRepo: SchedulePatternDayChildRepository = new SchedulePatternDayChildRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly queries: SchedulePatternQueryService = schedulePatternQueryService,
    private readonly materialisation: ScheduleMaterialisationService = scheduleMaterialisationService
  ) {}

  /** Sketch a draft pattern. Owner/parent only. `timezone` is copied from the household, never client-set. */
  async create(
    userId: string,
    householdId: string,
    input: CreateSchedulePatternInput
  ): Promise<SchedulePattern> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new NotAHouseholdParentError(householdId, 'none');
    }
    this.assertWriteRole(householdId, membership);

    const household = await this.householdRepo.findById(householdId);
    const timezone = household?.timezone ?? 'UTC';

    return this.patternRepo.create({
      household_id: householdId,
      carer_id: input.carer_id ?? null,
      status: 'draft',
      rrule: input.rrule,
      dtstart: input.dtstart,
      until: input.until ?? null,
      exdates: input.exdates ?? [],
      pause_ranges: input.pause_ranges ?? [],
      timezone,
      note: input.note ?? null,
      created_by: userId,
    });
  }

  /** Edit a draft pattern's own fields. Owner/parent only, draft only. */
  async update(
    userId: string,
    patternId: string,
    input: UpdateSchedulePatternInput
  ): Promise<SchedulePattern> {
    const pattern = await this.queries.getOwned(userId, patternId);
    await this.assertWriteMember(userId, pattern.household_id);
    this.assertDraft(pattern);
    return this.patternRepo.update(patternId, input);
  }

  /** Replace a draft pattern's days (and their children) wholesale. Owner/parent only, draft only. */
  async replaceDays(
    userId: string,
    patternId: string,
    input: ReplaceSchedulePatternDaysInput
  ) {
    const pattern = await this.queries.getOwned(userId, patternId);
    await this.assertWriteMember(userId, pattern.household_id);
    this.assertDraft(pattern);

    const days = await this.dayRepo.replaceForPattern(
      patternId,
      input.days.map(day => ({
        weekday: day.weekday,
        start_time: day.start_time,
        end_time: day.end_time,
      }))
    );

    for (const [index, day] of days.entries()) {
      const source = input.days[index];
      const children = source?.children ?? [];
      if (children.length > 0) {
        await this.dayChildRepo.insertForDay(
          day.id,
          children.map(child => ({
            child_id: child.child_id,
            start_time: child.start_time,
            end_time: child.end_time,
          }))
        );
      }
    }

    return this.queries.getWithDays(userId, patternId);
  }

  /** draft -> pending. Owner/parent only; requires a carer to send to. */
  async send(userId: string, patternId: string): Promise<SchedulePattern> {
    const pattern = await this.queries.getOwned(userId, patternId);
    await this.assertWriteMember(userId, pattern.household_id);
    if (pattern.status !== 'draft') {
      throw new PatternNotDraftError(patternId, pattern.status);
    }
    if (!pattern.carer_id) {
      throw new PatternMissingCarerError(patternId);
    }
    return this.patternRepo.update(patternId, {
      status: 'pending',
      sent_at: new Date().toISOString(),
    });
  }

  /**
   * The carer accepts or declines. Only the assigned carer may respond.
   * Accepting materialises shifts from the pattern (see
   * `scheduleMaterialisationService`); declining does not.
   */
  async respond(
    userId: string,
    patternId: string,
    input: RespondToSchedulePatternInput
  ): Promise<SchedulePattern> {
    const pattern = await this.queries.getOwned(userId, patternId);
    if (pattern.carer_id !== userId) {
      throw new NotThePatternCarerError(patternId);
    }
    if (pattern.status !== 'pending') {
      throw new PatternNotPendingError(patternId, pattern.status);
    }

    const updated = await this.patternRepo.update(patternId, {
      status: input.status,
      responded_at: new Date().toISOString(),
    });

    if (input.status === 'accepted') {
      await this.materialiseAccepted(userId, updated);
    }

    return updated;
  }

  /** pending -> withdrawn. Owner/parent only — pulling back a proposal before a reply. */
  async withdraw(userId: string, patternId: string): Promise<SchedulePattern> {
    const pattern = await this.queries.getOwned(userId, patternId);
    await this.assertWriteMember(userId, pattern.household_id);
    if (pattern.status !== 'pending') {
      throw new PatternNotPendingError(patternId, pattern.status);
    }
    return this.patternRepo.update(patternId, { status: 'withdrawn' });
  }

  private async materialiseAccepted(
    userId: string,
    pattern: SchedulePattern
  ): Promise<void> {
    const withDays = await this.queries.getWithDays(userId, pattern.id);
    const horizonEnd = addDays(
      new Date(),
      DEFAULT_MATERIALISATION_HORIZON_DAYS
    );
    const horizon =
      pattern.until && pattern.until < horizonEnd ? pattern.until : horizonEnd;

    const occurrences = expandRecurrence(
      {
        rrule: pattern.rrule,
        dtstart: pattern.dtstart,
        until: pattern.until,
        exdates: pattern.exdates,
        pauseRanges: pattern.pause_ranges,
        timezone: pattern.timezone,
        days: withDays.days.map(day => ({
          weekday: day.weekday,
          startTime: day.start_time,
          endTime: day.end_time,
          children: day.children.map(child => ({
            childId: child.child_id,
            startTime: child.start_time,
            endTime: child.end_time,
          })),
        })),
      },
      horizon
    );

    await this.materialisation.materialise(
      {
        id: pattern.id,
        householdId: pattern.household_id,
        carerId: pattern.carer_id,
        timezone: pattern.timezone,
        icalUid: pattern.ical_uid,
        note: pattern.note,
      },
      occurrences
    );
  }

  private async assertWriteMember(
    userId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      userId
    );
    if (!membership) {
      throw new NotAHouseholdParentError(householdId, 'none');
    }
    this.assertWriteRole(householdId, membership);
  }

  private assertWriteRole(
    householdId: string,
    membership: HouseholdMember
  ): void {
    if (!WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(householdId, membership.role);
    }
  }

  private assertDraft(pattern: SchedulePattern): void {
    if (pattern.status !== 'draft') {
      throw new PatternNotEditableError(pattern.id, pattern.status);
    }
  }
}

function addDays(date: Date, days: number): string {
  const result = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  return result.toISOString().slice(0, 10);
}

// Singleton for controllers/routes that don't need DI.
export const schedulePatternCommandService =
  new SchedulePatternCommandService();
