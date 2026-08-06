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
import {
  AlreadyClockedInError,
  CancellationPaidAlreadyRecordedError,
} from '../errors/timesheetErrors';

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

/**
 * A finished entry written in one shot — retroactive worked sessions and
 * cancellation-pay rows. Both land `submitted` (never `running`), so they
 * never contend with `time_entries_one_running_per_carer`.
 */
export interface NewSubmittedTimeEntryData {
  household_id: string;
  carer_id: string;
  carer_display_name: string;
  shift_id: string | null;
  clock_in_at: string;
  clock_out_at: string;
  break_minutes: number;
  scheduled_minutes: number | null;
  timezone: string;
  kind: TimeEntry['kind'];
  status: 'submitted';
  note?: string | null;
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

  /**
   * Insert a finished (already clocked-out) entry. Used by forgotten-clock-in
   * recovery and cancellation-pay recording — neither path has a `running`
   * phase, so this does not share `clockIn`'s one-running-per-carer 23505
   * translation.
   *
   * For `kind = 'cancellation_paid'`, a 23505 on
   * `time_entries_one_cancellation_paid_per_span` (053) becomes
   * `CancellationPaidAlreadyRecordedError` so `recordCancellationPaidEntry`
   * can re-fetch that FRAGMENT's winner by `(shift_id, clock_in_at)`.
   */
  async createSubmitted(data: NewSubmittedTimeEntryData): Promise<TimeEntry> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data)
      .select()
      .single();

    if (error) {
      if (
        error.code === UNIQUE_VIOLATION &&
        data.kind === 'cancellation_paid' &&
        data.shift_id
      ) {
        throw new CancellationPaidAlreadyRecordedError(data.shift_id);
      }
      throw new DatabaseError(
        'Failed to create submitted time entry',
        'DATABASE_ERROR',
        {
          details: error.message,
          code: error.code,
        }
      );
    }
    return created as TimeEntry;
  }

  /**
   * Whether a shift has ANY `cancellation_paid` entry — the
   * "already settled?" question `cancellationPayReconcileJob` asks.
   *
   * `.limit(1)` is load-bearing since migration 053: the unique index is now
   * `time_entries_one_cancellation_paid_per_span`, keyed on
   * `(shift_id, clock_in_at)`, so a cancelled window that was split around
   * real worked time legitimately has SEVERAL rows, and a bare
   * `maybeSingle()` errors the moment it sees more than one.
   *
   * ponytail: answers "at least one exists", not "all fragments exist" — a
   * partially written split still reads as settled here. Callers that must
   * distinguish should re-run `recordCancellationPaidEntry`, which is
   * self-healing and writes only what is missing.
   */
  async findCancellationPaidForShift(
    shiftId: string
  ): Promise<TimeEntry | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('shift_id', shiftId)
      .eq('kind', 'cancellation_paid')
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up cancellation-paid time entry',
        'DATABASE_ERROR',
        { details: error.message, shiftId }
      );
    }
    return data as TimeEntry | null;
  }

  /**
   * The `cancellation_paid` row for ONE fragment of a shift, identified the
   * same way migration 053's unique index identifies it:
   * `(shift_id, clock_in_at)`.
   *
   * This is the 23505 recovery lookup. A shift-wide fetch was fine when only
   * one such row could exist; with split remainders it could hand back a
   * DIFFERENT fragment than the one whose insert lost the race.
   */
  async findCancellationPaidForSpan(
    shiftId: string,
    clockInAt: string
  ): Promise<TimeEntry | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('shift_id', shiftId)
      .eq('kind', 'cancellation_paid')
      .eq('clock_in_at', clockInAt)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up cancellation-paid time entry for span',
        'DATABASE_ERROR',
        { details: error.message, shiftId, clockInAt }
      );
    }
    return data as TimeEntry | null;
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

  /**
   * Every entry for this carer whose CLOCK SPAN could intersect
   * `[fromInclusive, toInclusive]` — the overlap check's source, deliberately
   * NOT `listForCarerWeek`.
   *
   * `local_date` is FROZEN at write time from the row's own `timezone`
   * column, so a week-filtered lookup cannot see an entry that started on the
   * other side of Monday and is still running at the instant being checked —
   * nor one whose household has since changed timezone. Clock instants have
   * no such ambiguity, so the overlap question is asked of them and nothing
   * else.
   *
   * Running entries (`clock_out_at IS NULL`) are INCLUDED: they have no
   * finish to compare, but a session that starts inside the span being
   * written is exactly the collision that leaves a row nobody can ever clock
   * out (`timesheetCommandService.assertNoOverlap` decides that in-process).
   *
   * This is a COARSE pre-filter, same convention as
   * `timesheetCommandService.matchConfirmedShift`: the exact half-open
   * intersection is re-applied in the service, so behaviour never depends on
   * PostgREST's comparison semantics staying in lockstep with the domain's.
   *
   * Scoped to the CARER, deliberately NOT to a household. A carer cannot be
   * in two places at once, and the DB already agrees: the
   * `time_entries_one_running_per_carer` index (017:63-65) is keyed on
   * `carer_id` with no household predicate. Filtering by household here would
   * let the same hour be booked twice across two families while the running
   * index still treats her as one person — two different answers to "who is
   * on the clock".
   *
   * ponytail: no index covers `(carer_id, clock_in_at)` — the row set this
   * returns is tiny (one carer, spans touching one instant), so the planner's
   * carer_id filter is enough today. Add a btree_gist EXCLUDE constraint on
   * `(carer_id, tstzrange(clock_in_at, clock_out_at))` when a migration is on
   * the table anyway; that would make this check a backstop rather than the
   * only line of defence.
   */
  async listOverlapCandidatesForCarer(
    carerId: string,
    fromInclusive: string,
    toInclusive: string
  ): Promise<TimeEntry[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('carer_id', carerId)
      .lte('clock_in_at', toInclusive)
      .or(`clock_out_at.gte.${fromInclusive},clock_out_at.is.null`);

    if (error) {
      throw new DatabaseError(
        'Failed to list overlapping time entries',
        'DATABASE_ERROR',
        { details: error.message, carerId, fromInclusive }
      );
    }
    return (data ?? []) as TimeEntry[];
  }

  /**
   * A household's entries for `[weekStart, weekEndExclusive)` ('YYYY-MM-DD'),
   * newest clock-in first. `carerId` narrows to ONE carer — omit it and every
   * carer's entries come back, which is only ever right for a household-wide
   * view, never for a total someone gets paid against (F-B1-3).
   */
  async listForHouseholdWeek(
    householdId: string,
    weekStart: string,
    weekEndExclusive: string,
    carerId?: string
  ): Promise<TimeEntry[]> {
    let query = supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .gte('local_date', weekStart)
      .lt('local_date', weekEndExclusive);
    if (carerId) {
      query = query.eq('carer_id', carerId);
    }
    const { data, error } = await query.order('clock_in_at', {
      ascending: false,
    });

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
