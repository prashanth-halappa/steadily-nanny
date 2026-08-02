/**
 * Shift-event repository — access to the `shift_events` append-only day
 * thread. Reads are the primary purpose; the one write path is the
 * idempotent bulk-append pair below (`listEventKeysForDate` + `insertMany`),
 * which callers use to append an event without ever double-raising the same
 * `payload.key`:
 *   - the child domain's `coverageGapService.raiseGapsOnce`
 *     (`coverage_gap`), and
 *   - the schedule domain's `scheduleMaterialisationService`
 *     (`pattern_conflict`) — re-materialisation re-expands every pattern from
 *     `dtstart` on every horizon run, so an unkeyed append would grow this
 *     table without bound.
 * Still append-only: there is NO update/delete method anywhere here,
 * matching the DB's policy: an editable audit trail is not an audit trail
 * (see supabase/migrations/015_shifts.sql).
 *
 * @module domains/shift/repositories/shiftEventRepository
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

/** One row to append. `shift_id` is nullable for day-level events (see migration 015). */
export interface NewShiftEventInput {
  household_id: string;
  shift_id: string | null;
  local_date: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
}

export class ShiftEventRepository {
  private readonly table = 'shift_events';

  /** The day-thread entries tied to one shift, oldest first. */
  async listForShift(
    householdId: string,
    shiftId: string
  ): Promise<ShiftEvent[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list shift events', 'DATABASE_ERROR', {
        details: error.message,
        householdId,
        shiftId,
      });
    }
    return (data ?? []) as ShiftEvent[];
  }

  /**
   * Day-level thread for a household calendar date — includes rows with
   * nullable `shift_id` (D24). Distinct from `listForShift`, which stays
   * shift-scoped and never silently widens.
   */
  async listForHouseholdDate(
    householdId: string,
    localDate: string
  ): Promise<ShiftEvent[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('local_date', localDate)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list day-thread events',
        'DATABASE_ERROR',
        { details: error.message, householdId, localDate }
      );
    }
    return (data ?? []) as ShiftEvent[];
  }

  /**
   * The `payload.key` values already raised for this household/date/
   * event_type — the de-dupe set an idempotent raiser (e.g.
   * `coverageGapService.raiseGapsOnce`,
   * `scheduleMaterialisationService`'s `pattern_conflict`) checks BEFORE
   * inserting, so re-running never doubles up the day thread. There
   * is no unique DB constraint enforcing this (see migration 015 — shift
   * events are freeform), so the guarantee is entirely at this call site.
   */
  async listEventKeysForDate(
    householdId: string,
    localDate: string,
    eventType: string
  ): Promise<Set<string>> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('payload')
      .eq('household_id', householdId)
      .eq('local_date', localDate)
      .eq('event_type', eventType);

    if (error) {
      throw new DatabaseError(
        'Failed to list existing shift event keys',
        'DATABASE_ERROR',
        { details: error.message, householdId, localDate, eventType }
      );
    }
    const rows = (data ?? []) as { payload: Record<string, unknown> }[];
    return new Set(
      rows
        .map(row => row.payload?.key)
        .filter((key): key is string => typeof key === 'string')
    );
  }

  /**
   * Bulk append-only insert. Callers (e.g. `coverageGapService.
   * raiseGapsOnce`) are expected to have already filtered out any
   * `payload.key` returned by `listEventKeysForDate` — this method does not
   * re-check.
   */
  async insertMany(events: NewShiftEventInput[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const { error } = await supabaseService.from(this.table).insert(events);

    if (error) {
      throw new DatabaseError(
        'Failed to insert shift events',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
  }
}
