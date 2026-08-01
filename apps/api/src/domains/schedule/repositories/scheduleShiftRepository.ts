/**
 * Writes `shifts` rows FROM THE SCHEDULE DOMAIN — the one deliberate
 * exception to "a domain only writes its own tables". Materialising a
 * pattern into concrete shift rows is schedule-domain business logic (see
 * `services/scheduleMaterialisationService.ts`), and that logic must not
 * reach into `domains/shift/` (which owns shift response/negotiation flows —
 * accept, counter-offer, split, handover — a different bounded concern) to
 * avoid a domain-boundary cycle. This repository is scoped narrowly to what
 * materialisation needs: find-by-pattern, create, update, delete, plus the
 * two satellite tables it also has to keep in sync (`shift_children`,
 * `shift_events`). It never queries `shift_change_requests` for anything
 * beyond "does at least one exist" (used to detect a manually-negotiated
 * shift the re-materialiser must not clobber).
 *
 * @module domains/schedule/repositories/scheduleShiftRepository
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

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

export interface NewShiftEventData {
  household_id: string;
  shift_id: string | null;
  local_date: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
}

export class ScheduleShiftRepository {
  private readonly table = 'shifts';
  private readonly childrenTable = 'shift_children';
  private readonly changeRequestsTable = 'shift_change_requests';
  private readonly eventsTable = 'shift_events';

  /** The materialised shift for one pattern occurrence, or null if never created. */
  async findByPatternAndDate(
    patternId: string,
    localDate: string
  ): Promise<Shift | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('source_pattern_id', patternId)
      .eq('local_date', localDate)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find shift by pattern and date',
        'DATABASE_ERROR',
        { details: error.message, patternId, localDate }
      );
    }
    return data as Shift | null;
  }

  /** Every shift ever tied to this pattern, any status — the reconciliation set. */
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

  /** True if the shift has EVER had a change request opened against it (any status). */
  async hasChangeRequests(shiftId: string): Promise<boolean> {
    const { count, error } = await supabaseService
      .from(this.changeRequestsTable)
      .select('id', { count: 'exact', head: true })
      .eq('shift_id', shiftId);

    if (error) {
      throw new DatabaseError(
        'Failed to check shift change requests',
        'DATABASE_ERROR',
        { details: error.message, shiftId }
      );
    }
    return (count ?? 0) > 0;
  }

  async create(data: NewShiftData): Promise<Shift> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data)
      .select()
      .single();

    if (error) {
      throw new DatabaseError('Failed to create shift', 'DATABASE_ERROR', {
        details: error.message,
        code: error.code,
      });
    }
    return created as Shift;
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

  async delete(id: string): Promise<void> {
    const { error } = await supabaseService
      .from(this.table)
      .delete()
      .eq('id', id);

    if (error) {
      throw new DatabaseError('Failed to delete shift', 'DATABASE_ERROR', {
        details: error.message,
        id,
      });
    }
  }

  /** Clients (and the re-materialiser) replace a shift's children wholesale. */
  async replaceChildren(
    shiftId: string,
    children: NewShiftChildData[]
  ): Promise<void> {
    const { error: deleteError } = await supabaseService
      .from(this.childrenTable)
      .delete()
      .eq('shift_id', shiftId);

    if (deleteError) {
      throw new DatabaseError(
        'Failed to clear shift children',
        'DATABASE_ERROR',
        { details: deleteError.message, shiftId }
      );
    }

    if (children.length === 0) {
      return;
    }

    const { error: insertError } = await supabaseService
      .from(this.childrenTable)
      .insert(children.map(child => ({ shift_id: shiftId, ...child })));

    if (insertError) {
      throw new DatabaseError(
        'Failed to insert shift children',
        'DATABASE_ERROR',
        { details: insertError.message, shiftId }
      );
    }
  }

  /** Append-only day-thread entry — see migration 015's comment: an editable audit trail is not an audit trail. */
  async insertEvent(data: NewShiftEventData): Promise<void> {
    const { error } = await supabaseService.from(this.eventsTable).insert(data);

    if (error) {
      throw new DatabaseError(
        'Failed to insert shift event',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
  }
}
