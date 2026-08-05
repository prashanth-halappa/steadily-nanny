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
   * THE TWO-PART PREDICATE IS THE WHOLE POINT (review finding 13, Phase 2
   * review finding 1, `docs/11-MONEY.md` §3). The service computes earnings
   * from the week's entries and then writes them; between those two moments a
   * concurrent clock-out roll-up can land new hours — D1's exact surface, now
   * with money attached.
   *
   * `status` alone does NOT cover that. `rollUpIntoTimesheet` writes
   * `total_minutes` on an already-`submitted` week and leaves `status` where
   * it is, so a status-only predicate is blind to the one interleaving that
   * matters most:
   *
   *   parent approves       → the engine prices 20h at £370.00
   *   nanny clocks out 8h   → roll-up sets total_minutes = 28h, still submitted
   *   status-only CAS       → matches, stamps `approved`, freezes £370.00
   *
   * 28h of hours signed off at a 20h price, on a row that looks internally
   * consistent forever. So the predicate also pins `updated_at` to the value
   * the service read BEFORE it computed: `expectedUpdatedAt`. `timesheets`
   * carries `updated_at` maintained by the `set_timesheets_updated_at` trigger
   * (017 → `public.set_updated_at`, `before update ... for each row`), which
   * fires on EVERY update of the row including the roll-up's, so it is a true
   * row version and needs no new column. Its precision is Postgres's
   * transaction timestamp at microseconds; the roll-up and the approve are
   * separate requests and therefore separate transactions, so they can never
   * share one.
   *
   * The predicate is deliberately conservative in one direction: a roll-up
   * that rewrote the row with identical values still bumps `updated_at` and
   * still fails the approve. That costs the parent one extra tap and buys the
   * guarantee that no approval can ever outrun the hours it covers — the
   * right side to err on for a number people get paid against.
   *
   * `expectedUpdatedAt` is a WHERE, never a SET: the trigger owns that column,
   * and writing it here would both fight the trigger and destroy the version.
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
    patch: ApproveWithEarningsPatch,
    expectedUpdatedAt: string
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
      .eq('updated_at', expectedUpdatedAt)
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
