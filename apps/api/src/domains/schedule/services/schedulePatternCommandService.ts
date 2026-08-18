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
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { ValidationError } from '../../../errors';
import {
  ChildNotFoundError,
  type ChildQueryService,
  childQueryService,
} from '../../child';
import { detectUncoveredCareBestEffort } from '../../child/services/detectUncoveredCareForDate';
import type { HouseholdMember } from '../../household';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyHouseholdParents, notifyUser } from '../../notification';
import { addDays as addCalendarDate } from '../../pay/utils/localDateSpan';
import { localDateOf } from '../../timesheet/utils/weekStart';
import {
  InvalidPatternCarerError,
  InvalidPatternChildError,
  NotThePatternCarerError,
  PatternMissingCarerError,
  PatternNotAcceptedError,
  PatternNotDraftError,
  PatternNotEditableError,
  PatternNotPendingError,
} from '../errors/scheduleErrors';
import { SchedulePatternDayChildRepository } from '../repositories/schedulePatternDayChildRepository';
import { SchedulePatternDayRepository } from '../repositories/schedulePatternDayRepository';
import { SchedulePatternRepository } from '../repositories/schedulePatternRepository';
import type {
  AmendSchedulePatternInput,
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

  /**
   * Edit a draft pattern's own fields. Owner/parent only, draft only.
   *
   * Explicitly whitelists the fields forwarded to the repository — belt and
   * braces alongside `UpdateSchedulePatternSchema` dropping `status`: the
   * schema stops a client-sent `status` at the door, this stops it (or any
   * other stray key) from ever reaching a write even if it somehow got
   * past validation. Accepting a pattern must only ever happen through
   * `respond()`, never this generic PATCH — see `NotThePatternCarerError` /
   * `PatternNotPendingError` there for the carer-only, pending-only gate.
   *
   * `carer_id`, like on `create`, is validated with `assertCarerRole` — a
   * caller cannot PATCH it to an arbitrary uuid (including their own) and
   * then walk `send` + `respond` to a self-accepted pattern.
   */
  async update(
    userId: string,
    patternId: string,
    input: UpdateSchedulePatternInput
  ): Promise<SchedulePattern> {
    const pattern = await this.queries.getOwned(userId, patternId);
    await this.assertWriteMember(userId, pattern.household_id);
    this.assertDraft(pattern);
    if (input.carer_id) {
      await this.assertCarerRole(pattern.household_id, input.carer_id);
    }
    return this.patternRepo.update(patternId, {
      ...(input.carer_id !== undefined ? { carer_id: input.carer_id } : {}),
      ...(input.rrule !== undefined ? { rrule: input.rrule } : {}),
      ...(input.dtstart !== undefined ? { dtstart: input.dtstart } : {}),
      ...(input.until !== undefined ? { until: input.until } : {}),
      ...(input.exdates !== undefined ? { exdates: input.exdates } : {}),
      ...(input.pause_ranges !== undefined
        ? { pause_ranges: input.pause_ranges }
        : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
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

    // Postgres returns `time` columns as `HH:MM:SS` ('07:00:00') while the client
    // sends `HH:MM` ('07:00'). We must slice to 5 characters to normalise both sides,
    // otherwise lookups fail and children are silently dropped.
    // Index-based matching was replaced because DB row return order is undefined.
    const inputMap = new Map(
      input.days.map(day => [
        `${day.weekday}|${day.start_time.slice(0, 5)}`,
        day,
      ])
    );

    for (const day of days) {
      const source = inputMap.get(
        `${day.weekday}|${day.start_time.slice(0, 5)}`
      );
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
    const updated = await this.patternRepo.update(patternId, {
      status: 'pending',
      sent_at: new Date().toISOString(),
    });
    notifyUser(pattern.carer_id, {
      title: 'Usual week proposed',
      body: 'A parent sent you a usual week — open Schedule to respond.',
      data: {
        type: PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_SENT,
        patternId: pattern.id,
        householdId: pattern.household_id,
      },
    });
    return updated;
  }

  /**
   * Amend an accepted pattern's skips / pauses / end date only (not day or
   * time — that stays a new draft proposal). Re-materialises immediately so
   * future shifts match, then pushes the carer.
   *
   * When `until` is in the past after the write, status flips to `ended`
   * (the CHECK already allows it; this is the write path that was missing).
   * "Today" is the calendar date in `pattern.timezone` — UTC would leave
   * east-of-UTC zones accepted many hours late.
   *
   * `now` is injectable so tests (and callers that already have a clock) can
   * pin the materialisation / ended cutoff without mocking `Date`.
   */
  async amend(
    userId: string,
    patternId: string,
    input: AmendSchedulePatternInput,
    now: Date = new Date()
  ): Promise<SchedulePattern> {
    const pattern = await this.queries.getOwned(userId, patternId);
    await this.assertWriteMember(userId, pattern.household_id);
    if (pattern.status !== 'accepted') {
      throw new PatternNotAcceptedError(patternId, pattern.status);
    }

    if (
      input.until !== undefined &&
      input.until !== null &&
      input.until < pattern.dtstart
    ) {
      throw new ValidationError(
        'until must be on or after dtstart',
        'INVALID_UNTIL',
        400,
        { until: input.until, dtstart: pattern.dtstart }
      );
    }

    const today = localDateOf(now, pattern.timezone);
    const nextUntil = input.until !== undefined ? input.until : pattern.until;
    const ended = nextUntil !== null && nextUntil < today;

    const patch = {
      ...(input.exdates !== undefined ? { exdates: input.exdates } : {}),
      ...(input.pause_ranges !== undefined
        ? { pause_ranges: input.pause_ranges }
        : {}),
      ...(input.until !== undefined ? { until: input.until } : {}),
      sequence: pattern.sequence + 1,
    };
    // An amend that pushes `until` into the past ENDS the pattern — and an
    // ended pattern must not leave its future shifts on the calendar, so it
    // goes through `endPattern` rather than writing `status` here.
    const updated = ended
      ? await this.endPattern(patternId, now, patch)
      : await this.patternRepo.update(patternId, patch);

    await this.materialiseAccepted(updated, now);

    if (updated.carer_id) {
      notifyUser(updated.carer_id, {
        title: 'Usual week updated',
        body: 'A parent changed holiday skips or the end date on your usual week.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_AMENDED,
          patternId: updated.id,
          householdId: updated.household_id,
        },
      });
    }

    return updated;
  }

  /**
   * The carer accepts or declines. Only the assigned carer may respond —
   * checked two ways, mirroring `shiftCommandService.accept`: identity
   * (`carer_id === userId`) AND the caller's current household role is
   * still a carer role. The role check matters even though `carer_id` can
   * now only ever be set to a genuine carer (see `assertCarerRole` on
   * `create`/`update`) — a carer who has since left the household, or any
   * future path that sets `carer_id` less carefully, must not still be able
   * to accept. Same error either way, exactly like `accept` reusing
   * `ShiftNotFoundError` for both its checks — a caller must not be able to
   * distinguish "wrong person" from "right id, wrong role" by probing.
   * Accepting materialises shifts from the pattern (see
   * `scheduleMaterialisationService`); declining does not.
   */
  async respond(
    userId: string,
    patternId: string,
    input: RespondToSchedulePatternInput,
    now: Date = new Date()
  ): Promise<SchedulePattern> {
    const pattern = await this.queries.getOwned(userId, patternId);
    if (pattern.carer_id !== userId) {
      throw new NotThePatternCarerError(patternId);
    }
    const membership = await this.memberRepo.findActiveMembership(
      pattern.household_id,
      userId
    );
    if (!membership || !CARER_ROLES.has(membership.role)) {
      throw new NotThePatternCarerError(patternId);
    }
    if (pattern.status !== 'pending') {
      throw new PatternNotPendingError(patternId, pattern.status);
    }

    const updated = await this.patternRepo.update(patternId, {
      status: input.status,
      responded_at: now.toISOString(),
      decline_message:
        input.status === 'declined' ? input.message?.trim() || null : null,
    });

    if (input.status === 'accepted') {
      // Supersede BEFORE materialising: the prior pattern's identical future
      // shifts are cancelled first, so migration 062's unique index has
      // nothing live to collide with when this pattern inserts its own rows.
      await this.supersedePriorAccepted(updated, now);
      await this.materialiseAccepted(updated, now);
    }

    notifyHouseholdParents(pattern.household_id, {
      title: input.status === 'accepted' ? 'Week accepted' : 'Week declined',
      body:
        input.status === 'accepted'
          ? 'Your usual week was accepted. Shifts are on the calendar.'
          : 'Your usual week was declined.',
      data: {
        type: PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_RESPONDED,
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
    const updated = await this.patternRepo.update(patternId, {
      status: 'withdrawn',
    });
    if (updated.carer_id) {
      notifyUser(updated.carer_id, {
        title: 'Usual week withdrawn',
        body: 'A parent pulled back the usual week they sent you.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.SCHEDULE_PATTERN_WITHDRAWN,
          patternId: updated.id,
          householdId: updated.household_id,
        },
      });
    }
    return updated;
  }

  /**
   * The ONE place a pattern becomes `ended`: flips the status AND withdraws
   * the future shifts it already materialised (see
   * `scheduleMaterialisationService.cancelFutureShiftsForEndedPattern`).
   * Every path that ends a pattern routes through here — supersede-on-accept,
   * `amend`'s until-in-the-past, and the horizon job via
   * `materialiseForHorizon` — because the leak this closes is per-path
   * otherwise: an ended pattern whose shifts stay on the calendar has no live
   * pattern behind them, and nothing else ever cleans them up
   * (`scheduleHorizonJob` only iterates `listAccepted`).
   *
   * `extraPatch` lets `amend` write its own fields in the SAME update rather
   * than a second round trip.
   */
  private async endPattern(
    patternId: string,
    now: Date,
    extraPatch: Partial<SchedulePattern> = {}
  ): Promise<SchedulePattern> {
    const updated = await this.patternRepo.update(patternId, {
      ...extraPatch,
      status: 'ended',
    });
    await this.materialisation.cancelFutureShiftsForEndedPattern(
      patternId,
      now
    );
    return updated;
  }

  /**
   * One accepted usual week per (household, carer) — migration 014's header
   * always defined `ended` as "superseded or past its `until` date", but only
   * the second half was ever implemented. Accepting a new pattern ENDS every
   * other accepted pattern for the same carer (and withdraws their future
   * shifts, via `endPattern`). Without this, each accepted pattern
   * materialised the same days independently — `findByPatternAndDate` is
   * scoped to `source_pattern_id` and cannot see another pattern's row at the
   * identical instant — and the family got byte-identical duplicate shifts.
   *
   * Scoped to the accepting pattern's OWN carer: another carer's accepted
   * week in the same household is a different job, not a superseded one.
   */
  private async supersedePriorAccepted(
    accepted: SchedulePattern,
    now: Date
  ): Promise<void> {
    const priors = await this.patternRepo.listAcceptedByHouseholdAndCarer(
      accepted.household_id,
      accepted.carer_id
    );
    for (const prior of priors) {
      if (prior.id === accepted.id) {
        continue;
      }
      await this.endPattern(prior.id, now);
    }
  }

  /**
   * `getDaysForPattern`, not `getWithDays`: both callers (`respond`, `amend`)
   * have already fetched the pattern AND run their own membership/role gate,
   * so `getWithDays` would re-read the pattern row and re-check the same
   * membership — two hosted-DB round trips for answers we already hold. Same
   * "the caller is the trust boundary" reasoning as `materialiseForHorizon`.
   */
  private async materialiseAccepted(
    pattern: SchedulePattern,
    now: Date = new Date()
  ): Promise<void> {
    const days = await this.queries.getDaysForPattern(pattern.id);
    await this.runMaterialisation(
      pattern,
      days,
      DEFAULT_MATERIALISATION_HORIZON_DAYS,
      now
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
   *
   * `now` is forwarded to materialisation (orphan future/past) and to the
   * timezone-aware `ended` cutoff.
   */
  async materialiseForHorizon(
    pattern: SchedulePattern,
    horizonDays: number = DEFAULT_MATERIALISATION_HORIZON_DAYS,
    now: Date = new Date()
  ): Promise<MaterialiseResult> {
    const days = await this.queries.getDaysForPattern(pattern.id);
    const result = await this.runMaterialisation(
      pattern,
      days,
      horizonDays,
      now
    );
    const today = localDateOf(now, pattern.timezone);
    if (
      pattern.status === 'accepted' &&
      pattern.until !== null &&
      pattern.until < today
    ) {
      await this.endPattern(pattern.id, now);
    }
    return result;
  }

  private async runMaterialisation(
    pattern: SchedulePattern,
    days: SchedulePatternDayWithChildren[],
    horizonDays: number,
    now: Date = new Date()
  ): Promise<MaterialiseResult> {
    const horizonEnd = addDays(now, horizonDays);
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

    const result = await this.materialisation.materialise(
      {
        id: pattern.id,
        householdId: pattern.household_id,
        carerId: pattern.carer_id,
        timezone: pattern.timezone,
        icalUid: pattern.ical_uid,
        note: pattern.note,
      },
      occurrences,
      now
    );

    const today = localDateOf(now, pattern.timezone);
    const windowEnd = addCalendarDate(today, 7);
    for (const localDate of result.touchedDates) {
      if (localDate >= today && localDate <= windowEnd) {
        detectUncoveredCareBestEffort({
          householdId: pattern.household_id,
          localDate,
          cause: 'nothingScheduled',
        });
      }
    }

    return result;
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
