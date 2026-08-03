/**
 * Time-entry repository — data access for the `time_entries` table. Extends
 * BaseRepository for standard CRUD and adds the domain queries the
 * clock-in/out flow needs, plus `hasTimeEntries`, which is the one method
 * consumed OUTSIDE this domain — by `scheduleMaterialisationService`'s
 * `TimeEntryExistenceRepository` dependency, so a shift someone has clocked
 * into is never rewritten by re-materialisation. Uses the service-role
 * Supabase client, so ownership/authorization is enforced in the SERVICE
 * layer, never here.
 *
 * @module domains/timesheet/repositories/timeEntryRepository
 */
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { AlreadyClockedInError } from '../errors/timesheetErrors';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

export interface NewTimeEntryData {
  household_id: string;
  carer_id: string;
  // Snapshotted from the carer's profile at clock-in — see
  // supabase/migrations/033_preserve_payroll_on_carer_deletion.sql. Written
  // once, on insert; never re-derived from `carer_id` on read, so the record
  // survives the carer's profile being deleted.
  carer_display_name: string;
  shift_id: string | null;
  clock_in_at: string;
  timezone: string;
  kind: TimeEntry['kind'];
  status: TimeEntry['status'];
}

export class TimeEntryRepository extends BaseRepository<TimeEntry> {
  constructor() {
    super('time_entries');
  }

  /**
   * Start a clock-in. Translates the DB's
   * `time_entries_one_running_per_carer` partial unique index (23505) into a
   * clean AlreadyClockedInError instead of a raw 500 — the defence against a
   * double clock-in racing past the service-level pre-check in
   * `timesheetCommandService.clockIn`.
   */
  async clockIn(data: NewTimeEntryData): Promise<TimeEntry> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new AlreadyClockedInError(data.carer_id);
      }
      throw new DatabaseError('Failed to clock in', 'DATABASE_ERROR', {
        details: error.message,
        code: error.code,
      });
    }
    return created as TimeEntry;
  }

  /** The caller's own open (running) entry, or null. At most one can exist per carer. */
  async findRunningForCarer(carerId: string): Promise<TimeEntry | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('carer_id', carerId)
      .eq('status', 'running')
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up running time entry',
        'DATABASE_ERROR',
        { details: error.message, carerId }
      );
    }
    return data as TimeEntry | null;
  }

  /** A household's entries for `[weekStart, weekEndExclusive)` ('YYYY-MM-DD'), newest clock-in first. */
  async listForHouseholdWeek(
    householdId: string,
    weekStart: string,
    weekEndExclusive: string
  ): Promise<TimeEntry[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .gte('local_date', weekStart)
      .lt('local_date', weekEndExclusive)
      .order('clock_in_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list time entries for week',
        'DATABASE_ERROR',
        { details: error.message, householdId, weekStart }
      );
    }
    return (data ?? []) as TimeEntry[];
  }

  /**
   * ONE carer's entries for `[weekStart, weekEndExclusive)` — the source
   * `timesheetCommandService.rollUpIntoTimesheet` sums fresh on every
   * clock-out to derive `total_minutes`, rather than incrementing a running
   * counter. Deriving from this list on every call is what makes the
   * roll-up idempotent: a retried/duplicated/replayed clock-out recomputes
   * the same total instead of adding to one.
   */
  async listForCarerWeek(
    householdId: string,
    carerId: string,
    weekStart: string,
    weekEndExclusive: string
  ): Promise<TimeEntry[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .gte('local_date', weekStart)
      .lt('local_date', weekEndExclusive);

    if (error) {
      throw new DatabaseError(
        'Failed to list time entries for carer week',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId, weekStart }
      );
    }
    return (data ?? []) as TimeEntry[];
  }

  /**
   * Whether ANY time entry has ever been recorded against `shiftId` — the
   * lookup `scheduleMaterialisationService` asks on every occurrence it
   * considers rewriting, so this must stay cheap (see `time_entries_shift_idx`,
   * sized for exactly this query).
   */
  async hasTimeEntries(shiftId: string): Promise<boolean> {
    const { count, error } = await supabaseService
      .from(this.table)
      .select('id', { count: 'exact', head: true })
      .eq('shift_id', shiftId);

    if (error) {
      throw new DatabaseError(
        'Failed to check time entries for shift',
        'DATABASE_ERROR',
        { details: error.message, shiftId }
      );
    }
    return (count ?? 0) > 0;
  }
}
