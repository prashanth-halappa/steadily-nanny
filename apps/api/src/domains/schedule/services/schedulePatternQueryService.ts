/**
 * Schedule-pattern query service (CQRS-lite: reads). Ownership here is
 * MEMBERSHIP of the pattern's household, exactly like the household domain —
 * see `../../household`, imported READ-ONLY for its `HouseholdMemberRepository`.
 * `getOwned` throws the SAME `SchedulePatternNotFoundError` whether the
 * pattern truly doesn't exist or the caller just isn't a member of its
 * household, so existence is never leaked to a non-member (the widget-domain
 * "fetch then check" shape from docs/04-API-ARCHITECTURE.md §2.1, since — unlike
 * household membership — a pattern's household isn't known until it's fetched).
 *
 * @module domains/schedule/services/schedulePatternQueryService
 */
import { HouseholdMemberRepository } from '../../household';
import { SchedulePatternNotFoundError } from '../errors/scheduleErrors';
import { SchedulePatternDayChildRepository } from '../repositories/schedulePatternDayChildRepository';
import { SchedulePatternDayRepository } from '../repositories/schedulePatternDayRepository';
import { SchedulePatternRepository } from '../repositories/schedulePatternRepository';
import type {
  SchedulePattern,
  SchedulePatternDay,
  SchedulePatternDayChild,
} from '../types';

export interface SchedulePatternDayWithChildren extends SchedulePatternDay {
  children: SchedulePatternDayChild[];
}

export interface SchedulePatternWithDays extends SchedulePattern {
  days: SchedulePatternDayWithChildren[];
}

export class SchedulePatternQueryService {
  constructor(
    private readonly patternRepo: SchedulePatternRepository = new SchedulePatternRepository(),
    private readonly dayRepo: SchedulePatternDayRepository = new SchedulePatternDayRepository(),
    private readonly dayChildRepo: SchedulePatternDayChildRepository = new SchedulePatternDayChildRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository()
  ) {}

  /** List a household's patterns. Caller must be an active member. */
  async listForHousehold(
    userId: string,
    householdId: string
  ): Promise<SchedulePattern[]> {
    await this.assertMember(userId, householdId);
    return this.patternRepo.listForHousehold(householdId);
  }

  /**
   * Fetch one pattern, enforcing membership of its household. Throws
   * SchedulePatternNotFoundError for both "doesn't exist" and "exists but
   * you're not a member of its household" — this is the `lookup` the
   * ownership middleware calls on /:patternId routes.
   */
  async getOwned(userId: string, patternId: string): Promise<SchedulePattern> {
    const pattern = await this.patternRepo.findById(patternId);
    if (!pattern) {
      throw new SchedulePatternNotFoundError(patternId);
    }
    const membership = await this.memberRepo.findActiveMembership(
      pattern.household_id,
      userId
    );
    if (!membership) {
      throw new SchedulePatternNotFoundError(patternId);
    }
    return pattern;
  }

  /** The pattern plus its full day/children breakdown, for the detail read. */
  async getWithDays(
    userId: string,
    patternId: string
  ): Promise<SchedulePatternWithDays> {
    const pattern = await this.getOwned(userId, patternId);
    const days = await this.getDaysForPattern(patternId);
    return { ...pattern, days };
  }

  /**
   * Days + per-day children for a pattern, WITHOUT the ownership check
   * `getWithDays` wraps it in above. Exists for system callers that already
   * trust their own pattern selection rather than a single user's request —
   * currently `schedulePatternCommandService.materialiseForHorizon`, called
   * by the horizon-rolling job (`jobs/scheduleHorizonJob.ts`) for every
   * accepted pattern, not one caller's own. Never call this directly from a
   * user-facing route.
   */
  async getDaysForPattern(
    patternId: string
  ): Promise<SchedulePatternDayWithChildren[]> {
    const days = await this.dayRepo.listForPattern(patternId);
    const children = await this.dayChildRepo.listForDays(
      days.map(day => day.id)
    );

    const childrenByDay = new Map<string, SchedulePatternDayChild[]>();
    for (const child of children) {
      const existing = childrenByDay.get(child.pattern_day_id) ?? [];
      existing.push(child);
      childrenByDay.set(child.pattern_day_id, existing);
    }

    return days.map(day => ({
      ...day,
      children: childrenByDay.get(day.id) ?? [],
    }));
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
      throw new SchedulePatternNotFoundError(householdId, {
        reason: 'household_not_accessible',
      });
    }
  }
}

// Singleton for controllers/routes that don't need DI.
export const schedulePatternQueryService = new SchedulePatternQueryService();
