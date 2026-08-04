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

import { MATERIALISATION_HORIZON_DAYS } from '@steadily-nanny/shared-types';
import {
  ChildNotFoundError,
  type ChildQueryService,
  childQueryService,
} from '../../child';
import type { HouseholdMember } from '../../household';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyHouseholdParents } from '../../notification';
import {
  InvalidPatternCarerError,
  InvalidPatternChildError,
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
import type { MaterialiseResult } from './scheduleMaterialisationService';
import {
  type ScheduleMaterialisationService,
  scheduleMaterialisationService,
} from './scheduleMaterialisationService';
import {
  type SchedulePatternDayWithChildren,
  type SchedulePatternQueryService,
  schedulePatternQueryService,
} from './schedulePatternQueryService';

const WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);
const CARER_ROLES: ReadonlySet<string> = new Set([HOUSEHOLD_ROLES.NANNY]);

/**
 * How far ahead of "now" a pattern is materialised — both on acceptance
 * (`respond`, below) and on every re-run of the horizon-rolling job
 * (`jobs/scheduleHorizonJob.ts`, which calls `materialiseForHorizon` for
 * every already-accepted pattern so this window keeps rolling forward
 * instead of freezing at whatever was materialised on acceptance day).
 *
 * Source of truth: `@steadily-nanny/shared-types` `MATERIALISATION_HORIZON_DAYS`
 * (mobile Schedule week-nav derives its forward clamp from the same package).
 */
export const DEFAULT_MATERIALISATION_HORIZON_DAYS =
  MATERIALISATION_HORIZON_DAYS;

export class SchedulePatternCommandService {
  constructor(
    private readonly patternRepo: SchedulePatternRepository = new SchedulePatternRepository(),
    private readonly dayRepo: SchedulePatternDayRepository = new SchedulePatternDayRepository(),
    private readonly dayChildRepo: SchedulePatternDayChildRepository = new SchedulePatternDayChildRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    private readonly queries: SchedulePatternQueryService = schedulePatternQueryService,
    private readonly materialisation: ScheduleMaterialisationService = scheduleMaterialisationService,
    private readonly children: ChildQueryService = childQueryService
  ) {}

  /**
   * Sketch a draft pattern. Owner/parent only. `timezone` is copied from the
   * household, never client-set. `carer_id`, if given, must be an active
   * NANNY member of THIS household — see `assertCarerRole`; a bare
   * membership check isn't enough, since a co-parent is a valid member but
   * not a valid carer.
   */
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

    if (input.carer_id) {
      await this.assertCarerRole(householdId, input.carer_id);
    }

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

  /**
   * Replace a draft pattern's days (and their children) wholesale.
   * Owner/parent only, draft only. Every `child_id` referenced across every
   * day is verified to belong to THIS pattern's household — see
   * `assertChildrenBelongToHousehold` — before anything is written, so a bad
   * id fails the whole call cleanly rather than leaving days replaced with
   * some children missing.
   */
  async replaceDays(
    userId: string,
    patternId: string,
    input: ReplaceSchedulePatternDaysInput
  ) {
    const pattern = await this.queries.getOwned(userId, patternId);
    await this.assertWriteMember(userId, pattern.household_id);
    this.assertDraft(pattern);
    await this.assertChildrenBelongToHousehold(
      userId,
      pattern.household_id,
      input.days
    );

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
      decline_message:
        input.status === 'declined' ? input.message?.trim() || null : null,
    });

    if (input.status === 'accepted') {
      await this.materialiseAccepted(userId, updated);
    }

    notifyHouseholdParents(pattern.household_id, {
      title: input.status === 'accepted' ? 'Week accepted' : 'Week declined',
      body:
        input.status === 'accepted'
          ? 'Your usual week was accepted. Shifts are on the calendar.'
          : 'Your usual week was declined.',
      data: {
        type: 'schedule_pattern_responded',
        patternId: pattern.id,
        householdId: pattern.household_id,
        status: input.status,
      },
    });

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
    await this.runMaterialisation(
      pattern,
      withDays.days,
      DEFAULT_MATERIALISATION_HORIZON_DAYS
    );
  }

  /**
   * Re-materialise an already-accepted pattern out to a fresh horizon. This
   * is the same logic `respond`'s accept branch runs (see
   * `materialiseAccepted`, above) factored out so the horizon-rolling job
   * (`jobs/scheduleHorizonJob.ts`) can call it for every accepted pattern —
   * NOT scoped to one caller's own request, so no ownership check here: the
   * job's own "every accepted pattern" listing (`SchedulePatternRepository.listAccepted`)
   * is the trust boundary, exactly like `respond`'s prior carer check is for
   * `materialiseAccepted`.
   */
  async materialiseForHorizon(
    pattern: SchedulePattern,
    horizonDays: number = DEFAULT_MATERIALISATION_HORIZON_DAYS
  ): Promise<MaterialiseResult> {
    const days = await this.queries.getDaysForPattern(pattern.id);
    return this.runMaterialisation(pattern, days, horizonDays);
  }

  private async runMaterialisation(
    pattern: SchedulePattern,
    days: SchedulePatternDayWithChildren[],
    horizonDays: number
  ): Promise<MaterialiseResult> {
    const horizonEnd = addDays(new Date(), horizonDays);
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
        days: days.map(day => ({
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

    return this.materialisation.materialise(
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

  /**
   * `carer_id` must be an active NANNY member of `householdId` — not merely
   * a member (a co-parent is an active member but not a valid carer), and
   * not merely a real user id (a stranger with no relationship to the
   * household). Same error either way — see `InvalidPatternCarerError`.
   */
  private async assertCarerRole(
    householdId: string,
    carerId: string
  ): Promise<void> {
    const carerMembership = await this.memberRepo.findActiveMembership(
      householdId,
      carerId
    );
    if (!carerMembership || !CARER_ROLES.has(carerMembership.role)) {
      throw new InvalidPatternCarerError(householdId, carerId);
    }
  }

  /**
   * Every `child_id` referenced across every day must belong to
   * `householdId`. Reuses `ChildQueryService.getOwned` — the SAME check the
   * child domain's own routes use — rather than a fourth hand-rolled
   * variant of the underlying membership/household check. Its own
   * `ChildNotFoundError` is translated to `InvalidPatternChildError` here:
   * the caller is always a parent of THIS household (already role-checked
   * by `replaceDays`), so a specific "not part of your household" message
   * is safe and better UX — it reveals nothing about any OTHER household —
   * whereas `ChildNotFoundError`'s opaque wording exists for callers who
   * don't already own the household in question.
   */
  private async assertChildrenBelongToHousehold(
    userId: string,
    householdId: string,
    days: ReplaceSchedulePatternDaysInput['days']
  ): Promise<void> {
    const childIds = new Set(
      days.flatMap(day => day.children.map(child => child.child_id))
    );
    for (const childId of childIds) {
      try {
        await this.children.getOwned(userId, householdId, childId);
      } catch (error) {
        if (error instanceof ChildNotFoundError) {
          throw new InvalidPatternChildError(householdId, childId);
        }
        throw error;
      }
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
