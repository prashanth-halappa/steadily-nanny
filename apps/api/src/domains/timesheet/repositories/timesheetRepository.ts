/**
 * Timesheet repository — data access for the `timesheets` table (the weekly
 * roll-up a parent approves in one tap). Extends BaseRepository for standard
 * CRUD and adds the find-by-week query the clock-out flow uses to keep a
 * running total, plus the ONE conditional write that freezes a week's
 * earnings. Uses the service-role client, so ownership/authorization is
 * enforced in the SERVICE layer, never here.
 *
 * @module domains/timesheet/repositories/timesheetRepository
 */
import type {
  Timesheet,
  TimesheetStatus,
} from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

/**
 * The four earnings-snapshot columns added by migration 042.
 *
 * Deliberately NOT on the wire `TimesheetSchema`: they are storage, and the
 * week response exposes the same data already parsed and state-tagged as
 * `TimesheetWeekSchema.earnings`. Shipping the raw columns too would let a
 * client read the frozen jsonb without the legacy/corrupt handling the
 * server does on its behalf (`docs/11-MONEY.md` §3).
 *
 * `earnings` is `unknown`, not `WeekEarnings`: it is whatever Postgres has in
 * that jsonb column, which for a hand-edited or pre-042 row may be anything
 * at all. Every reader must parse it through `WeekEarningsSchema` — typing it
 * as the happy shape here would let a caller skip exactly the validation the
 * corrupt-snapshot arm exists for.
 */
export interface TimesheetEarningsSnapshot {
  gross_minor: number | null;
  currency: string | null;
  earnings: unknown;
  earnings_computed_at: string | null;
}

/** A `timesheets` row as the database actually returns it. */
export type TimesheetRow = Timesheet & TimesheetEarningsSnapshot;

/**
 * All four snapshot columns, nulled.
 *
 * Exported so the D1 reopen path in `timesheetCommandService` clears the
 * snapshot with the *same literal* the approve path writes over, and neither
 * can grow a column the other forgets. Migration 042's contract is that all
 * four are set together and cleared together — the DB does not enforce it,
 * this constant is how the service layer keeps its word.
 */
export const CLEARED_EARNINGS_SNAPSHOT: TimesheetEarningsSnapshot = {
  gross_minor: null,
  currency: null,
  earnings: null,
  earnings_computed_at: null,
};

/** Everything the approve write sets besides `status`. */
export interface ApproveWithEarningsPatch extends TimesheetEarningsSnapshot {
  approved_by: string;
  approved_at: string;
}

/** The status an approve may transition FROM. Anything else is a lost race. */
const APPROVABLE_FROM: TimesheetStatus = 'submitted';

export class TimesheetRepository extends BaseRepository<TimesheetRow> {
  constructor() {
    super('timesheets');
  }

  /** The one timesheet for (household, carer, week), or null. Unique per `timesheets_household_carer_week_idx`. */
  async findByWeek(
    householdId: string,
    carerId: string,
    weekStart: string
  ): Promise<TimesheetRow | null> {
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
    return data as TimesheetRow | null;
  }

  /** A household's timesheets, most recent week first. */
  async listForHousehold(householdId: string): Promise<TimesheetRow[]> {
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
    return (data ?? []) as TimesheetRow[];
  }

  /**
   * COMPARE-AND-SET `submitted` → `approved`, freezing the earnings snapshot
   * in the SAME statement.
   *
   * THE `.eq('status', 'submitted')` IS THE WHOLE POINT (review finding 13,
   * `docs/11-MONEY.md` §3). The service computes earnings from the week's
   * entries and then writes them; between those two moments a concurrent
   * clock-out roll-up can land new hours and re-open the week — D1's exact
   * surface, now with money attached. Without the status predicate this
   * UPDATE would happily stamp an approval, and a gross figure, onto a week
   * that had changed underneath it. With it, the statement matches zero rows
   * and nothing is written: no snapshot, no approval, no half-state.
   *
   * Same shape as `shiftRepository.confirmPending` — one guarded UPDATE,
   * `maybeSingle()`, and `null` for "lost the race". The caller turns that
   * null into the domain's existing status-race error rather than the
   * repository inventing a second one.
   *
   * `query_note` is cleared here as it always was on approval: an approved
   * week has no outstanding question.
   */
  async approveSubmittedWithEarnings(
    timesheetId: string,
    patch: ApproveWithEarningsPatch
  ): Promise<TimesheetRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({
        status: 'approved',
        query_note: null,
        approved_by: patch.approved_by,
        approved_at: patch.approved_at,
        gross_minor: patch.gross_minor,
        currency: patch.currency,
        earnings: patch.earnings,
        earnings_computed_at: patch.earnings_computed_at,
      })
      .eq('id', timesheetId)
      .eq('status', APPROVABLE_FROM)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to approve timesheet with earnings',
        'DATABASE_ERROR',
        { details: error.message, timesheetId }
      );
    }
    return data as TimesheetRow | null;
  }
}
