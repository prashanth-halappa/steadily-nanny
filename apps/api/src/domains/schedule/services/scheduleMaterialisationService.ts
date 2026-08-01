/**
 * Idempotent re-materialisation: turns `expandRecurrence`'s pure occurrences
 * into `shifts` rows, and reconciles rows an amended pattern no longer
 * produces. Writing to `shifts` is the schedule domain's one authorized
 * exception to "never write another domain's table" (see
 * `repositories/scheduleShiftRepository.ts`'s header comment) — this service
 * is the ONLY place that repository is called from.
 *
 * EXISTING-SHIFT POLICY (see the wave-2 spec table this implements):
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
 * @module domains/schedule/services/scheduleMaterialisationService
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  type NewShiftChildData,
  type NewShiftData,
  type NewShiftEventData,
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
  hasChangeRequests(shiftId: string): Promise<boolean>;
  create(data: NewShiftData): Promise<Shift>;
  update(id: string, data: Partial<Shift>): Promise<Shift>;
  delete(id: string): Promise<void>;
  replaceChildren(
    shiftId: string,
    children: NewShiftChildData[]
  ): Promise<void>;
  insertEvent(data: NewShiftEventData): Promise<void>;
}

const NEVER_TOUCH_STATUSES: ReadonlySet<Shift['status']> = new Set([
  'completed',
  'cancelled',
]);

/** Deterministic per-occurrence UID: stable across re-materialisations of the same pattern+date. */
export function deriveOccurrenceIcalUid(
  patternIcalUid: string,
  localDate: string
): string {
  return `${patternIcalUid}::${localDate}`;
}

export class ScheduleMaterialisationService {
  constructor(
    private readonly shiftRepo: MaterialisationShiftRepository = new ScheduleShiftRepository()
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
      await this.materialiseOne(pattern, occ, result);
    }

    const existingForPattern = await this.shiftRepo.findActiveByPattern(
      pattern.id
    );
    for (const shift of existingForPattern) {
      if (producedDates.has(shift.local_date)) {
        continue; // still produced this run — handled in the loop above
      }
      await this.reconcileOrphan(shift, now, result);
    }

    return result;
  }

  private async materialiseOne(
    pattern: PatternForMaterialisation,
    occ: ExpandedOccurrence,
    result: MaterialiseResult
  ): Promise<void> {
    const existing = await this.shiftRepo.findByPatternAndDate(
      pattern.id,
      occ.localDate
    );

    if (!existing) {
      const created = await this.shiftRepo.create({
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
      await this.shiftRepo.replaceChildren(created.id, toChildData(occ));
      result.created++;
      return;
    }

    if (NEVER_TOUCH_STATUSES.has(existing.status)) {
      return; // completed/cancelled — never touched, full stop
    }

    if (await this.isManuallyTouched(existing)) {
      await this.shiftRepo.insertEvent(
        conflictEvent(pattern, existing, occ.localDate)
      );
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

  private async reconcileOrphan(
    shift: Shift,
    now: Date,
    result: MaterialiseResult
  ): Promise<void> {
    if (NEVER_TOUCH_STATUSES.has(shift.status)) {
      return; // completed/cancelled — never touched, full stop
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
      result.conflicts.push({
        shiftId: shift.id,
        localDate: shift.local_date,
        reason: 'manually_edited_now_cancelled',
      });
    }
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

function conflictEvent(
  pattern: PatternForMaterialisation,
  shift: Shift,
  localDate: string
): NewShiftEventData {
  return {
    household_id: pattern.householdId,
    shift_id: shift.id,
    local_date: localDate,
    actor_id: null,
    event_type: 'pattern_conflict',
    payload: {
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
