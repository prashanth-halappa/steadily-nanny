/**
 * Schedule-pattern repository — data access for the `schedule_patterns`
 * table. Uses the service-role client, so ownership/authorization is
 * enforced in the SERVICE layer (membership + role checks), never here.
 *
 * @module domains/schedule/repositories/schedulePatternRepository
 */
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class SchedulePatternRepository extends BaseRepository<SchedulePattern> {
  constructor() {
    super('schedule_patterns');
  }

  /** Every pattern proposed for a household, newest first. */
  async listForHousehold(householdId: string): Promise<SchedulePattern[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list schedule patterns for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as SchedulePattern[];
  }

  /**
   * Every currently-`accepted` pattern for ONE (household, carer) — the
   * supersede set `respond`'s accept branch ends, so a household can never
   * hold two accepted usual weeks for the same carer materialising the same
   * days twice (migration 062).
   *
   * `carer_id` is nullable and an unassigned pattern is a real shape (014: a
   * parent sketching a usual week during onboarding, before any nanny
   * exists), so the null case matches `carer_id is null` — `eq('carer_id',
   * null)` would match nothing at all. Same null branch, same reasoning, as
   * `shiftRepository.findExtraShiftInWindow`.
   */
  async listAcceptedByHouseholdAndCarer(
    householdId: string,
    carerId: string | null
  ): Promise<SchedulePattern[]> {
    const base = supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'accepted');
    const { data, error } = await (carerId
      ? base.eq('carer_id', carerId)
      : base.is('carer_id', null));

    if (error) {
      throw new DatabaseError(
        'Failed to list accepted schedule patterns for a carer',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId }
      );
    }
    return (data ?? []) as SchedulePattern[];
  }

  /**
   * Every currently-accepted pattern across every household — the
   * horizon-rolling job's own trust boundary (see
   * `jobs/scheduleHorizonJob.ts`): it re-materialises every row this
   * returns, unscoped by household or caller, unlike every other read in
   * this domain.
   */
  async listAccepted(): Promise<SchedulePattern[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('status', 'accepted');

    if (error) {
      throw new DatabaseError(
        'Failed to list accepted schedule patterns',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return (data ?? []) as SchedulePattern[];
  }
}
