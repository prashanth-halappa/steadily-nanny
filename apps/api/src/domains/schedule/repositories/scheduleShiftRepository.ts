/**
 * Writes `shifts` rows FROM THE SCHEDULE DOMAIN — the one deliberate
 * exception to "a domain only writes its own tables". Materialising a
 * pattern into concrete shift rows is schedule-domain business logic (see
 * `services/scheduleMaterialisationService.ts`), and that logic must not
 * reach into `domains/shift/` (which owns shift response/negotiation flows —
 * accept, counter-offer, split, handover — a different bounded concern) to
 * avoid a domain-boundary cycle. This repository is scoped narrowly to what
 * materialisation needs: find-by-pattern, create, update, delete, plus the
 * satellite table it also has to keep in sync (`shift_children`). It never
 * queries `shift_change_requests` for anything beyond "does at least one
 * exist" (used to detect a manually-negotiated shift the re-materialiser
 * must not clobber), and it no longer writes `shift_events` at all: the
 * `pattern_conflict` row must be raised at most once per (pattern, shift,
 * date), so it goes through the shift domain's idempotent bulk-append pair
 * instead — see `services/scheduleMaterialisationService.ts`'s header.
 *
 * @module domains/schedule/repositories/scheduleShiftRepository
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { RecurringShiftAlreadyExistsError } from '../errors/scheduleErrors';

export interface NewShiftData {
  household_id: string;
  carer_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  kind: Shift['kind'];
  status: Shift['status'];
  source_pattern_id: string | null;
  origin: Shift['origin'];
  note: string | null;
  ical_uid: string;
}

export interface NewShiftChildData {
  child_id: string;
  starts_at: string | null;
  ends_at: string | null;
}

const UNIQUE_VIOLATION = '23505';
/** Migration 062's partial unique index — the name the 23505 is matched on. */
const RECURRING_WINDOW_UNIQUE_INDEX = 'shifts_recurring_window_unique';

/**
 * Whether a Postgres error is 062's duplicate-recurring-window collision.
 * Matched on the CONSTRAINT NAME, not the bare code — `shifts` has other
 * unique keys (`ical_uid`, 059's extra-shift index), and mistranslating one of
 * those would send the materialiser hunting for a duplicate that does not
 * exist. Same shape as `shiftRepository.isExtraWindowCollision`.
 */
function isRecurringWindowCollision(error: {
  code?: string;
  message: string;
  details?: string | null;
}): boolean {
  return (
    error.code === UNIQUE_VIOLATION &&
    `${error.message} ${error.details ?? ''}`.includes(
      RECURRING_WINDOW_UNIQUE_INDEX
    )
  );
}

export class ScheduleShiftRepository {
  private readonly table = 'shifts';
  private readonly childrenTable = 'shift_children';
  private readonly changeRequestsTable = 'shift_change_requests';

  /**
   * Every shift ever tied to this pattern, any status — the reconciliation
   * set, AND (since it already carries `local_date`) the occurrence lookup
   * the materialiser indexes in memory. There used to be a
   * `findByPatternAndDate` called once per occurrence; on a hosted DB that
   * was one ~150ms round trip per day of the horizon.
   */
  async findActiveByPattern(patternId: string): Promise<Shift[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('source_pattern_id', patternId);

    if (error) {
      throw new DatabaseError(
        'Failed to list shifts for pattern',
        'DATABASE_ERROR',
        { details: error.message, patternId }
      );
    }
    return (data ?? []) as Shift[];
  }

  /**
   * Which of `shiftIds` have EVER had a change request opened against them
   * (any status) — one round trip for a whole materialisation run, replacing
   * the per-shift `hasChangeRequests` probe.
   */
  async shiftIdsWithChangeRequests(shiftIds: string[]): Promise<Set<string>> {
    if (shiftIds.length === 0) {
      return new Set();
    }
    const { data, error } = await supabaseService
      .from(this.changeRequestsTable)
      .select('shift_id')
      .in('shift_id', shiftIds);

    if (error) {
      throw new DatabaseError(
        'Failed to check shift change requests',
        'DATABASE_ERROR',
        { details: error.message, count: shiftIds.length }
      );
    }
    return new Set(
      (data ?? []).map(row => (row as { shift_id: string }).shift_id)
    );
  }

  /**
   * A live `recurring` shift with exactly this carer and window, whatever
   * pattern produced it — the lookup behind the materialiser's
   * adopt-on-collision path. Cross-pattern by design: that is the whole point,
   * since `findByPatternAndDate` is blind to another pattern's row at the same
   * instant, which is how the duplicates got created in the first place.
   */
  async findRecurringInWindow(
    householdId: string,
    carerId: string | null,
    startsAt: string,
    endsAt: string
  ): Promise<Shift | null> {
    const base = supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('kind', 'recurring')
      .eq('starts_at', startsAt)
      .eq('ends_at', endsAt)
      .neq('status', 'cancelled');
    const { data, error } = await (carerId
      ? base.eq('carer_id', carerId)
      : base.is('carer_id', null)
    ).limit(1);

    if (error) {
      throw new DatabaseError(
        'Failed to look for an existing recurring shift',
        'DATABASE_ERROR',
        { details: error.message, householdId, startsAt, endsAt }
      );
    }
    return (data?.[0] as Shift | undefined) ?? null;
  }

  /**
   * Translates 062's `shifts_recurring_window_unique` violation (23505) into
   * `RecurringShiftAlreadyExistsError` so the materialiser can adopt the
   * existing row instead of failing the whole run — same precedent as
   * `shiftRepository.createShift` and 059.
   */
  async create(data: NewShiftData): Promise<Shift> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data)
      .select()
      .single();

    if (error) {
      if (isRecurringWindowCollision(error)) {
        throw new RecurringShiftAlreadyExistsError({
          householdId: data.household_id,
          carerId: data.carer_id,
          startsAt: data.starts_at,
          endsAt: data.ends_at,
        });
      }
      throw new DatabaseError('Failed to create shift', 'DATABASE_ERROR', {
        details: error.message,
        code: error.code,
      });
    }
    return created as Shift;
  }

  /**
   * Insert a whole horizon's worth of occurrences in ONE statement.
   *
   * Returns `null` — never throws `RecurringShiftAlreadyExistsError` — when
   * 062's window index refuses one of the rows: a multi-row insert is a single
   * statement, so the violation aborts the lot and PostgREST cannot say WHICH
   * row lost. Nothing was written, so the caller retries row by row through
   * `create` (below), where the collision is attributable and the existing
   * shift can be adopted. Collisions are rare — supersede-on-accept cancels
   * the prior pattern's rows before this runs (GOLDEN-FIXES #27).
   */
  async createMany(rows: NewShiftData[]): Promise<Shift[] | null> {
    if (rows.length === 0) {
      return [];
    }
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(rows)
      .select();

    if (error) {
      if (isRecurringWindowCollision(error)) {
        return null;
      }
      throw new DatabaseError('Failed to create shifts', 'DATABASE_ERROR', {
        details: error.message,
        code: error.code,
        count: rows.length,
      });
    }
    return (created ?? []) as Shift[];
  }

  async update(id: string, data: Partial<Shift>): Promise<Shift> {
    const { data: updated, error } = await supabaseService
      .from(this.table)
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to update shift', 'DATABASE_ERROR', {
        details: error.message,
        id,
      });
    }
    return updated as Shift;
  }

  /**
   * Apply the SAME patch to many shifts in one statement. Only ever used for
   * patches that are identical by construction (the cancel patches); a
   * per-shift patch still goes through `update`.
   */
  async updateMany(ids: string[], data: Partial<Shift>): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const { error } = await supabaseService
      .from(this.table)
      .update(data)
      .in('id', ids);

    if (error) {
      throw new DatabaseError('Failed to update shifts', 'DATABASE_ERROR', {
        details: error.message,
        count: ids.length,
      });
    }
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const { error } = await supabaseService
      .from(this.table)
      .delete()
      .in('id', ids);

    if (error) {
      throw new DatabaseError('Failed to delete shifts', 'DATABASE_ERROR', {
        details: error.message,
        count: ids.length,
      });
    }
  }

  /**
   * Replace the children of many shifts wholesale: one delete for every
   * shift_id, one insert for every child row. Two round trips for a whole
   * horizon instead of two per occurrence.
   */
  async replaceChildrenMany(
    entries: { shiftId: string; children: NewShiftChildData[] }[]
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const shiftIds = entries.map(entry => entry.shiftId);
    const { error: deleteError } = await supabaseService
      .from(this.childrenTable)
      .delete()
      .in('shift_id', shiftIds);

    if (deleteError) {
      throw new DatabaseError(
        'Failed to clear shift children',
        'DATABASE_ERROR',
        { details: deleteError.message, count: shiftIds.length }
      );
    }

    const rows = entries.flatMap(entry =>
      entry.children.map(child => ({ shift_id: entry.shiftId, ...child }))
    );
    if (rows.length === 0) {
      return;
    }

    const { error: insertError } = await supabaseService
      .from(this.childrenTable)
      .insert(rows);

    if (insertError) {
      throw new DatabaseError(
        'Failed to insert shift children',
        'DATABASE_ERROR',
        { details: insertError.message, count: rows.length }
      );
    }
  }
}
