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
}
