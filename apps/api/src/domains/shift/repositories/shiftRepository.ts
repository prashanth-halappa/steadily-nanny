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
 * IMMUTABILITY GUARD: `update` refuses to touch a shift that is already
 * `completed`/`cancelled`, or that anyone has clocked into (`time_entries`).
 * This mirrors the policy `scheduleMaterialisationService` already enforces
 * on the re-materialisation write path (see its NEVER_TOUCH_STATUSES /
 * `hasTimeEntries` branches) and closes the same hole on the shift domain's
 * write path: accepting a change request must not rewrite past, paid-for
 * reality either. It lives HERE rather than in a service because both
 * change-request mutations (`applyAcceptedChange`'s cancel and time-change
 * branches) funnel through this one method — one chokepoint, no way around
 * it. Same precedent as `timeEntryRepository`, which also raises a domain
 * conflict error from the repository layer.
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
// Import the repository file DIRECTLY — never the timesheet domain barrel,
// whose services import this one back. Same narrow, read-only cross-domain
// dependency `scheduleMaterialisationService` already takes on
// `hasTimeEntries`.
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { ShiftImmutableError, ShiftNotFoundError } from '../errors/shiftErrors';

/** A shift joined with its `shift_children` rows — the shape the Supabase nested select (`*, shift_children(*)`) returns. */
export interface ShiftWithChildren extends Shift {
  shift_children: ShiftChild[];
}

/** The narrow contract behind "has anyone clocked into this shift?" — see `TimeEntryRepository.hasTimeEntries`. */
export interface ShiftTimeEntryExistenceRepository {
  hasTimeEntries(shiftId: string): Promise<boolean>;
}

/** Finished business: a shift in one of these statuses is never mutated again. */
const IMMUTABLE_STATUSES: ReadonlySet<Shift['status']> = new Set([
  'completed',
  'cancelled',
]);

export class ShiftRepository extends BaseRepository<Shift> {
  constructor(
    private readonly timeEntryRepo: ShiftTimeEntryExistenceRepository = new TimeEntryRepository()
  ) {
    super('shifts');
  }

  /**
   * Guarded update — see the IMMUTABILITY GUARD note in the module header.
   * Throws `ShiftImmutableError` (409) rather than silently no-op'ing, so an
   * accepted change request against a completed/cancelled/clocked-into shift
   * surfaces to the caller instead of quietly rewriting settled history.
   */
  override async update(id: string, data: Partial<Shift>): Promise<Shift> {
    await this.assertMutable(id);
    return super.update(id, data);
  }

  /** Throws unless the shift exists and is still open to mutation. */
  async assertMutable(shiftId: string): Promise<void> {
    const shift = await this.findById(shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(shiftId);
    }
    if (IMMUTABLE_STATUSES.has(shift.status)) {
      throw new ShiftImmutableError(shiftId, shift.status);
    }
    if (await this.timeEntryRepo.hasTimeEntries(shiftId)) {
      throw new ShiftImmutableError(shiftId, shift.status, 'has_time_entries');
    }
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

  /**
   * Every shift whose household-LOCAL calendar date is `localDate`, each
   * carrying its `shift_children`. Deliberately keyed on the stored
   * `local_date` column (kept in sync by migration 015's
   * `sync_shift_local_date` trigger) rather than a UTC range, because
   * coverage-gap detection reasons in the household's own wall clock — see
   * `coverageGapService`.
   */
  async findByHouseholdAndLocalDate(
    householdId: string,
    localDate: string
  ): Promise<ShiftWithChildren[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*, shift_children(*)')
      .eq('household_id', householdId)
      .eq('local_date', localDate)
      .order('starts_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list shifts for household local date',
        'DATABASE_ERROR',
        { details: error.message, householdId, localDate }
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

  /**
   * Atomic parent edit via `public.apply_parent_shift_edit` (migration 019):
   * UPDATE shift + INSERT `shift_updated` event in one transaction.
   */
  /** Create one shift row (extra-shift proposals, change-request outcomes). */
  async createShift(data: {
    household_id: string;
    carer_id: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string;
    kind: Shift['kind'];
    status: Shift['status'];
    origin: Shift['origin'];
    note?: string | null;
    reason?: string | null;
    created_by?: string | null;
    is_short_notice?: boolean;
  }): Promise<Shift> {
    return this.create({
      household_id: data.household_id,
      carer_id: data.carer_id,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      timezone: data.timezone,
      kind: data.kind,
      status: data.status,
      source_pattern_id: null,
      origin: data.origin,
      is_short_notice: data.is_short_notice ?? false,
      note: data.note ?? null,
      reason: data.reason ?? null,
      created_by: data.created_by ?? null,
      cancellation_paid: false,
      sequence: 0,
    });
  }

  /** Attach whole-shift child coverage rows (null start/end). */
  async insertChildren(shiftId: string, childIds: string[]): Promise<void> {
    if (childIds.length === 0) {
      return;
    }
    const rows = childIds.map(child_id => ({
      shift_id: shiftId,
      child_id,
      starts_at: null,
      ends_at: null,
    }));
    const { error } = await supabaseService.from('shift_children').insert(rows);

    if (error) {
      throw new DatabaseError(
        'Failed to insert shift children',
        'DATABASE_ERROR',
        { details: error.message, shiftId }
      );
    }
  }

  async applyParentEdit(args: {
    shiftId: string;
    actorId: string;
    startsAt: string | null;
    endsAt: string | null;
    note: string | null;
    setStartsAt: boolean;
    setEndsAt: boolean;
    setNote: boolean;
    origin: string;
    sequence: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }): Promise<Shift> {
    const { data, error } = await supabaseService.rpc(
      'apply_parent_shift_edit',
      {
        p_shift_id: args.shiftId,
        p_actor_id: args.actorId,
        p_starts_at: args.startsAt,
        p_ends_at: args.endsAt,
        p_note: args.note,
        p_set_starts_at: args.setStartsAt,
        p_set_ends_at: args.setEndsAt,
        p_set_note: args.setNote,
        p_origin: args.origin,
        p_sequence: args.sequence,
        p_before: args.before,
        p_after: args.after,
      }
    );

    if (error || !data) {
      throw new DatabaseError(
        'Failed to apply parent shift edit',
        'DATABASE_ERROR',
        { details: error?.message, shiftId: args.shiftId }
      );
    }
    return data as Shift;
  }
}
