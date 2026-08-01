/**
 * Timesheet repository — data access for the `timesheets` table (the weekly
 * roll-up a parent approves in one tap). Extends BaseRepository for standard
 * CRUD and adds the find-by-week query the clock-out flow uses to keep a
 * running total. Uses the service-role client, so ownership/authorization is
 * enforced in the SERVICE layer, never here.
 *
 * @module domains/timesheet/repositories/timesheetRepository
 */
import type { Timesheet } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class TimesheetRepository extends BaseRepository<Timesheet> {
  constructor() {
    super('timesheets');
  }

  /** The one timesheet for (household, carer, week), or null. Unique per `timesheets_household_carer_week_idx`. */
  async findByWeek(
    householdId: string,
    carerId: string,
    weekStart: string
  ): Promise<Timesheet | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .eq('week_start', weekStart)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up timesheet for week',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId, weekStart }
      );
    }
    return data as Timesheet | null;
  }

  /** A household's timesheets, most recent week first. */
  async listForHousehold(householdId: string): Promise<Timesheet[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .order('week_start', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list timesheets for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as Timesheet[];
  }
}
