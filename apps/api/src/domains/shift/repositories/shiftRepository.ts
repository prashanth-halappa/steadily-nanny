/**
 * Shift repository — data access for the `shifts` table, plus its nested
 * `shift_children`. Extends BaseRepository for standard CRUD (only `update`
 * and `findById` are used — this domain reads freely but writes only via the
 * parent-edit PATCH, see `shiftCommandService`) and adds the two read
 * queries the calendar feed needs. Uses the service-role Supabase client, so
 * ownership/authorization is enforced in the SERVICE layer, never here.
 *
 * NOTE: the `schedule` domain's `scheduleShiftRepository.ts` is the ONE
 * place that CREATES/DELETES `shifts` rows (materialisation) — this
 * repository never does either, avoiding any overlap with that write path.
 *
 * @module domains/shift/repositories/shiftRepository
 */
import type {
  Shift,
  ShiftChild,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

/** A shift joined with its `shift_children` rows — the shape the Supabase nested select (`*, shift_children(*)`) returns. */
export interface ShiftWithChildren extends Shift {
  shift_children: ShiftChild[];
}

export class ShiftRepository extends BaseRepository<Shift> {
  constructor() {
    super('shifts');
  }

  /**
   * Shifts overlapping `[from, to)`, each carrying its `shift_children` —
   * the primary calendar feed, sized to avoid an N+1 per-shift children
   * fetch. Overlap semantics match `busyBlockRepository.listForCarer`: a
   * shift STARTS before `to` AND ENDS after `from` (`.lt`/`.gt`, both
   * strict, so a shift that only touches the boundary is excluded).
   */
  async findByHouseholdAndRange(
    householdId: string,
    from: string,
    to: string
  ): Promise<ShiftWithChildren[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*, shift_children(*)')
      .eq('household_id', householdId)
      .lt('starts_at', to)
      .gt('ends_at', from)
      .order('starts_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list shifts for household range',
        'DATABASE_ERROR',
        { details: error.message, householdId, from, to }
      );
    }
    return (data ?? []) as ShiftWithChildren[];
  }

  /** One shift with its `shift_children`, or null. */
  async findByIdWithChildren(
    shiftId: string
  ): Promise<ShiftWithChildren | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*, shift_children(*)')
      .eq('id', shiftId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find shift with children',
        'DATABASE_ERROR',
        { details: error.message, shiftId }
      );
    }
    return data as ShiftWithChildren | null;
  }
}
