/**
 * Idempotent re-materialisation: turns `expandRecurrence`'s pure occurrences
 * into `shifts` rows, and reconciles rows an amended pattern no longer
 * produces. Writing to `shifts` is the schedule domain's one authorized
 * exception to "never write another domain's table" (see
 * `repositories/scheduleShiftRepository.ts`'s header comment) — this service
 * is the ONLY place that repository is called from.
 *
 * EXISTING-SHIFT POLICY (see the wave-2 spec table this implements):
 *   has a time_entries row            -> NEVER touched, full stop (past and
 *                                         paid-for reality is immutable —
 *                                         see supabase/migrations/017_time_tracking.sql)
 *   draft/pending, untouched         -> overwrite times, children, note
 *   confirmed, untouched             -> overwrite; back to pending if times moved
 *   manually touched (non-system     -> PRESERVE untouched; emit a
 *     origin, or any change request)    `pattern_conflict` shift_event; warn
 *   completed/cancelled              -> NEVER touched, full stop
 *   no longer produced by the RRULE  -> future+untouched: delete
 *                                        otherwise: cancel, reason
 *                                        'pattern_changed' (a manually-touched
 *                                        future shift being cancelled this way
 *                                        still surfaces as a conflict/warning)
 *
 * Consistent with the product rule throughout: conflicts warn, they never
 * block.
 *
 * PATTERN_CONFLICT EVENTS ARE RAISED AT MOST ONCE per (pattern, shift,
 * local_date). `isManuallyTouched` is true for any shift with a
 * `shift_change_requests` row — including withdrawn/declined ones — and the
 * horizon job re-expands every pattern from `dtstart` on every run, so a
 * plain append would add an identical `pattern_conflict` row to the
 * append-only `shift_events` table every night, forever. The conflict is
 * therefore written through the shift domain's idempotent bulk-append pair
 * (`ShiftEventRepository.listEventKeysForDate` + `insertMany`, the same
 * mechanism `coverageGapService.raiseGapsOnce` uses) keyed on
 * `payload.key`. The in-memory `result.conflicts` warning is still returned
 * on every run — only the persisted day-thread row is de-duplicated.
 *
 * The time_entries check is injected as a narrow `TimeEntryExistenceRepository`
 * (defaulting to the timesheet domain's `TimeEntryRepository`) rather than
 * added to `MaterialisationShiftRepository` — `time_entries` isn't a shift
 * write, and this keeps the schedule domain's own `ScheduleShiftRepository`
 * (which this service is the one authorized writer of, per its header
 * comment) untouched. Cross-domain, read-only import — same convention as
 * `schedulePatternQueryService`'s read of the household domain's
 * `HouseholdMemberRepository`.
 *
 * @module domains/schedule/services/scheduleMaterialisationService
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
// Import the repository files DIRECTLY — never a domain barrel — so this
// service never pulls another domain's service graph in behind them.
import {
  type NewShiftEventInput,
  ShiftEventRepository,
} from '../../shift/repositories/shiftEventRepository';
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { RecurringShiftAlreadyExistsError } from '../errors/scheduleErrors';
import {
  type NewShiftChildData,
  type NewShiftData,
  ScheduleShiftRepository,
} from '../repositories/scheduleShiftRepository';
import type { ExpandedOccurrence } from './recurrenceExpander';

/** The subset of a `schedule_patterns` row materialisation needs. */
export interface PatternForMaterialisation {
  id: string;
  householdId: string;
  carerId: string | null;
  timezone: string;
  /** The pattern's own `ical_uid` — occurrence UIDs are derived from this. */
  icalUid: string;
  note: string | null;
}

export type MaterialiseConflictReason =
  | 'manually_edited'
  | 'manually_edited_now_cancelled';

export interface MaterialiseConflict {
  shiftId: string;
  localDate: string;
  reason: MaterialiseConflictReason;
}

export interface MaterialiseResult {
  created: number;
  updated: number;
  deleted: number;
  cancelled: number;
  conflicts: MaterialiseConflict[];
}

/** The narrow repository contract this service depends on — see `ScheduleShiftRepository` for the production implementation. */
export interface MaterialisationShiftRepository {
  findByPatternAndDate(
    patternId: string,
    localDate: string
  ): Promise<Shift | null>;
  findActiveByPattern(patternId: string): Promise<Shift[]>;
  findRecurringInWindow(
    householdId: string,
    carerId: string | null,
    startsAt: string,
    endsAt: string
  ): Promise<Shift | null>;
  hasChangeRequests(shiftId: string): Promise<boolean>;
  create(data: NewShiftData): Promise<Shift>;
  update(id: string, data: Partial<Shift>): Promise<Shift>;
  delete(id: string): Promise<void>;
  replaceChildren(
    shiftId: string,
    children: NewShiftChildData[]
  ): Promise<void>;
}

/** The narrow contract this service needs to ask "has anyone clocked into this shift?" — see the module doc for why this isn't folded into `MaterialisationShiftRepository`. */
export interface TimeEntryExistenceRepository {
  hasTimeEntries(shiftId: string): Promise<boolean>;
}

/** The idempotent bulk-append pair this service raises `pattern_conflict` through — see `ShiftEventRepository`. */
export interface ConflictEventRepository {
  listEventKeysForDate(
    householdId: string,
    localDate: string,
    eventType: string
  ): Promise<Set<string>>;
  insertMany(events: NewShiftEventInput[]): Promise<void>;
}

const NEVER_TOUCH_STATUSES: ReadonlySet<Shift['status']> = new Set([
  'completed',
  'cancelled',
]);

const PATTERN_CONFLICT = 'pattern_conflict';

/** Deterministic per-occurrence UID: stable across re-materialisations of the same pattern+date. */
export function deriveOccurrenceIcalUid(
  patternIcalUid: string,
  localDate: string
): string {
  return `${patternIcalUid}::${localDate}`;
}

export class ScheduleMaterialisationService {
  constructor(
    private readonly shiftRepo: MaterialisationShiftRepository = new ScheduleShiftRepository(),
    private readonly timeEntryRepo: TimeEntryExistenceRepository = new TimeEntryRepository(),
    private readonly eventRepo: ConflictEventRepository = new ShiftEventRepository()
  ) {}

  async materialise(
    pattern: PatternForMaterialisation,
    occurrences: ExpandedOccurrence[],
    now: Date = new Date()
  ): Promise<MaterialiseResult> {
    const result: MaterialiseResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    };

    const producedDates = new Set(occurrences.map(occ => occ.localDate));

    for (const occ of occurrences) {
      await this.materialiseOne(pattern, occ, result, now);
    }

    const existingForPattern = await this.shiftRepo.findActiveByPattern(
      pattern.id
    );
    for (const shift of existingForPattern) {
      if (producedDates.has(shift.local_date)) {
        continue; // still produced this run — handled in the loop above
      }
      await this.reconcileOrphan(pattern, shift, now, result);
    }

    return result;
  }

  private async materialiseOne(
    pattern: PatternForMaterialisation,
    occ: ExpandedOccurrence,
    result: MaterialiseResult,
    now: Date
  ): Promise<void> {
    const existing = await this.shiftRepo.findByPatternAndDate(
      pattern.id,
      occ.localDate
    );

    if (!existing) {
      // F-B6-3: a horizon catch-up run (e.g. after the job was down for
      // days) re-expands from `dtstart` and can produce occurrences that
      // have already started. `occ.startsAt` is already an absolute UTC
      // instant (computed from the pattern's own timezone by
      // `expandRecurrence`), so comparing it straight against `now` is
      // correct regardless of the pattern's or server's timezone — no
      // separate zone conversion needed here. Never backfill one of these
      // as a brand-new `confirmed` shift nobody could ever have clocked
      // into; an occurrence that already has a row is untouched by this
      // guard and still flows through the normal update path below.
      if (new Date(occ.startsAt).getTime() <= now.getTime()) {
        return;
      }
      let created: Shift;
      try {
        created = await this.shiftRepo.create({
          household_id: pattern.householdId,
          carer_id: pattern.carerId,
          starts_at: occ.startsAt,
          ends_at: occ.endsAt,
          timezone: pattern.timezone,
          kind: 'recurring',
          status: 'confirmed',
          source_pattern_id: pattern.id,
          origin: 'system_generated',
          note: pattern.note,
          ical_uid: deriveOccurrenceIcalUid(pattern.icalUid, occ.localDate),
        });
      } catch (error) {
        if (!(error instanceof RecurringShiftAlreadyExistsError)) {
          throw error;
        }
        await this.adoptExistingWindow(pattern, occ, result, error);
        return;
      }
      await this.shiftRepo.replaceChildren(created.id, toChildData(occ));
      result.created++;
      return;
    }

    if (NEVER_TOUCH_STATUSES.has(existing.status)) {
      return; // completed/cancelled — never touched, full stop
    }

    if (await this.timeEntryRepo.hasTimeEntries(existing.id)) {
      return; // past and paid-for reality is immutable — see time_entries (017)
    }

    if (await this.isManuallyTouched(existing)) {
      await this.raiseConflictOnce(pattern, existing, occ.localDate);
      result.conflicts.push({
        shiftId: existing.id,
        localDate: occ.localDate,
        reason: 'manually_edited',
      });
      return;
    }

    const timesMoved =
      existing.starts_at !== occ.startsAt || existing.ends_at !== occ.endsAt;
    const nextStatus =
      existing.status === 'confirmed' && timesMoved
        ? 'pending'
        : existing.status;

    const updated = await this.shiftRepo.update(existing.id, {
      starts_at: occ.startsAt,
      ends_at: occ.endsAt,
      timezone: pattern.timezone,
      status: nextStatus,
      note: pattern.note,
      sequence: existing.sequence + 1,
    });
    await this.shiftRepo.replaceChildren(updated.id, toChildData(occ));
    result.updated++;
  }

  /**
   * 062's index refused the insert because a live `recurring` shift already
   * covers this exact (household, carer, window). Adopt it: re-point it at
   * THIS pattern so the next run finds it by pattern+date and stops
   * colliding, and treat it as an update rather than 500ing the carer who
   * just accepted. Same adopt-the-winner precedent as
   * `shiftChangeRequestCommandService.insertExtraShift` on 059.
   *
   * `ical_uid` is deliberately NOT re-keyed: it is the marker already sitting
   * in someone's device calendar (`calendarSync.ts`, GOLDEN-FIXES #16), and
   * rewriting it would orphan that event. Nothing reads the derived uid back —
   * it is only ever computed at create time.
   */
  private async adoptExistingWindow(
    pattern: PatternForMaterialisation,
    occ: ExpandedOccurrence,
    result: MaterialiseResult,
    collision: RecurringShiftAlreadyExistsError
  ): Promise<void> {
    const winner = await this.shiftRepo.findRecurringInWindow(
      pattern.householdId,
      pattern.carerId,
      occ.startsAt,
      occ.endsAt
    );
    if (!winner) {
      // The index says it exists, the lookup says it does not. Adopting
      // nothing would silently drop the occurrence; surface the conflict.
      throw collision;
    }
    const adopted = await this.shiftRepo.update(winner.id, {
      source_pattern_id: pattern.id,
      note: pattern.note,
      sequence: winner.sequence + 1,
    });
    await this.shiftRepo.replaceChildren(adopted.id, toChildData(occ));
    result.updated++;
  }

  /**
   * Withdraw what an ENDED pattern already put on the calendar: cancel its
   * FUTURE system-generated shifts. Every path that ends a pattern routes
   * through `schedulePatternCommandService.endPattern`, which calls this —
   * without it, a superseded or past-its-`until` pattern's shifts stayed on
   * the calendar forever with no live pattern behind them (and, for a
   * superseded pattern, sitting on top of the new pattern's identical rows).
   *
   * The exclusions mirror this service's existing policy table: past shifts
   * are reality and are never rewritten, `completed`/`cancelled` are finished
   * business, a clocked-into shift is paid-for reality (017), and a
   * manually-authored shift is not the pattern's to withdraw.
   *
   * Returns how many rows it cancelled.
   */
  async cancelFutureShiftsForEndedPattern(
    patternId: string,
    now: Date = new Date()
  ): Promise<number> {
    const shifts = await this.shiftRepo.findActiveByPattern(patternId);
    let cancelled = 0;
    for (const shift of shifts) {
      if (NEVER_TOUCH_STATUSES.has(shift.status)) {
        continue;
      }
      if (shift.origin !== 'system_generated') {
        continue;
      }
      if (new Date(shift.starts_at).getTime() <= now.getTime()) {
        continue;
      }
      if (await this.timeEntryRepo.hasTimeEntries(shift.id)) {
        continue;
      }
      await this.shiftRepo.update(shift.id, {
        status: 'cancelled',
        reason: 'pattern_ended',
        cancelled_at: now.toISOString(),
      });
      cancelled++;
    }
    return cancelled;
  }

  private async reconcileOrphan(
    pattern: PatternForMaterialisation,
    shift: Shift,
    now: Date,
    result: MaterialiseResult
  ): Promise<void> {
    if (NEVER_TOUCH_STATUSES.has(shift.status)) {
      return; // completed/cancelled — never touched, full stop
    }

    if (await this.timeEntryRepo.hasTimeEntries(shift.id)) {
      return; // past and paid-for reality is immutable — see time_entries (017)
    }

    const touched = await this.isManuallyTouched(shift);
    const isFuture = new Date(shift.starts_at).getTime() > now.getTime();

    if (!touched && isFuture) {
      await this.shiftRepo.delete(shift.id);
      result.deleted++;
      return;
    }

    await this.shiftRepo.update(shift.id, {
      status: 'cancelled',
      reason: 'pattern_changed',
      cancelled_at: now.toISOString(),
    });
    result.cancelled++;

    if (touched) {
      await this.raiseConflictOnce(pattern, shift, shift.local_date);
      result.conflicts.push({
        shiftId: shift.id,
        localDate: shift.local_date,
        reason: 'manually_edited_now_cancelled',
      });
    }
  }

  /**
   * Append a `pattern_conflict` day-thread row for this (pattern, shift,
   * local_date) unless one is already there — see the module header for why
   * a plain append grows without bound.
   */
  private async raiseConflictOnce(
    pattern: PatternForMaterialisation,
    shift: Shift,
    localDate: string
  ): Promise<void> {
    const key = conflictKey(pattern.id, shift.id, localDate);
    const existingKeys = await this.eventRepo.listEventKeysForDate(
      pattern.householdId,
      localDate,
      PATTERN_CONFLICT
    );
    if (existingKeys.has(key)) {
      return;
    }
    await this.eventRepo.insertMany([
      conflictEvent(pattern, shift, localDate, key),
    ]);
  }

  private async isManuallyTouched(shift: Shift): Promise<boolean> {
    if (shift.origin !== 'system_generated') {
      return true;
    }
    return this.shiftRepo.hasChangeRequests(shift.id);
  }
}

function toChildData(occ: ExpandedOccurrence): NewShiftChildData[] {
  return occ.children.map(child => ({
    child_id: child.childId,
    starts_at: child.startsAt,
    ends_at: child.endsAt,
  }));
}

/** De-dupe identity of one persisted conflict: the same pattern, shift and date is one row, however many times the horizon job re-expands it. */
function conflictKey(
  patternId: string,
  shiftId: string,
  localDate: string
): string {
  return `${patternId}|${shiftId}|${localDate}`;
}

function conflictEvent(
  pattern: PatternForMaterialisation,
  shift: Shift,
  localDate: string,
  key: string
): NewShiftEventInput {
  return {
    household_id: pattern.householdId,
    shift_id: shift.id,
    local_date: localDate,
    actor_id: null,
    event_type: PATTERN_CONFLICT,
    payload: {
      key,
      pattern_id: pattern.id,
      shift_origin: shift.origin,
      reason:
        'Shift was manually edited since it was generated — the pattern change was not applied to it.',
    },
  };
}

// Singleton for services/controllers that don't need DI.
export const scheduleMaterialisationService =
  new ScheduleMaterialisationService();
