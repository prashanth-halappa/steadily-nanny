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

/**
 * The statuses a query may transition FROM. Anything else is a lost race.
 *
 * `queried` is in the set because a NEW query supersedes rather than blocks
 * (D-19): a parent who spots a second problem must be able to say so, and
 * refusing would strand the week in a state whose only exit was the very
 * action being refused. The thread shows both queries in order — no
 * "superseded" label, the order already says it.
 */
const QUERYABLE_FROM: readonly TimesheetStatus[] = ['submitted', 'queried'];

/** The status a withdraw-query may transition FROM. */
const WITHDRAWABLE_FROM: TimesheetStatus = 'queried';

/** The status a reopen may transition FROM. Anything else is a lost race. */
const REOPENABLE_FROM: TimesheetStatus = 'approved';

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

  /**
   * A household's timesheets, most recent week first. `carerId` narrows to ONE
   * carer — omit it and every carer's every week comes back, which a caller
   * that then picks "the row for this week" resolves by week alone and binds
   * to whichever carer sorted first (F-B1-3).
   */
  async listForHousehold(
    householdId: string,
    carerId?: string
  ): Promise<TimesheetRow[]> {
    let query = supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId);
    if (carerId) {
      query = query.eq('carer_id', carerId);
    }
    const { data, error } = await query.order('week_start', {
      ascending: false,
    });

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
   * week has no outstanding question. `reopen_reason` is cleared the same
   * way — it is display state ("why does this week look undone right now"),
   * not the audit trail; the append-only `timesheet_reopened` shift_events
   * rows stay forever. Omitting the clear recreates the stale-note bug
   * class in a new column.
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
        reopen_reason: null,
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

  /**
   * COMPARE-AND-SET `submitted`/`queried` → `queried`, carrying the same
   * two-part predicate `approveSubmittedWithEarnings` does and for the same
   * reason.
   *
   * A query is decided against a row the service read before it wrote: the
   * parent is disputing the hours THEY looked at. Between the two moments a
   * clock-out roll-up can add hours (status untouched, so a status-only
   * predicate is blind to it) or another parent can approve the week, and a
   * blind write would then un-approve a week nobody was disputing and strand
   * a frozen snapshot on a `queried` row. Pinning `updated_at` makes both
   * interleavings a lost race the caller retries against what is actually
   * there.
   *
   * Same `maybeSingle()` + `null`-for-lost-race contract as approve.
   */
  async queryFromActionable(
    timesheetId: string,
    expectedUpdatedAt: string,
    note: string
  ): Promise<TimesheetRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: 'queried', query_note: note })
      .eq('id', timesheetId)
      .in('status', QUERYABLE_FROM)
      .eq('updated_at', expectedUpdatedAt)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to query timesheet', 'DATABASE_ERROR', {
        details: error.message,
        timesheetId,
      });
    }
    return data as TimesheetRow | null;
  }

  /**
   * COMPARE-AND-SET `queried` → `submitted` — the parent's exit from a
   * queried week (D-19, gap P2). Without it a queried week had NO parent-side
   * exit at all: `approve` only moves a `submitted` row, so a question asked
   * in error froze the nanny's pay until she typed something back.
   *
   * Same `updated_at` predicate as approve/query, for the same reason: between
   * the service's read and this write a roll-up can add hours (which already
   * returns the week to `submitted` unconditionally, D1) or a co-parent can
   * re-query, and a status-only predicate is blind to both.
   *
   * `query_note` IS cleared, and that is not a loss: the question now lives
   * permanently in the append-only thread (`utils/weekThread.ts`), so the
   * scratch column can go back to meaning exactly what it says — "a question
   * is outstanding on this week". Leaving it set on a `submitted` row would
   * recreate the stale-note bug class `approveSubmittedWithEarnings` clears it
   * to avoid. The thread itself is untouched: "What's already been said stays
   * on the record" is the confirm dialog's second sentence and it is
   * load-bearing for both personas.
   */
  async withdrawQueryFromQueried(
    timesheetId: string,
    expectedUpdatedAt: string
  ): Promise<TimesheetRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: 'submitted', query_note: null })
      .eq('id', timesheetId)
      .eq('status', WITHDRAWABLE_FROM)
      .eq('updated_at', expectedUpdatedAt)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to withdraw timesheet query',
        'DATABASE_ERROR',
        { details: error.message, timesheetId }
      );
    }
    return data as TimesheetRow | null;
  }

  /**
   * COMPARE-AND-SET `approved` → `submitted`, clearing the approval stamp AND
   * all four snapshot columns in the SAME statement.
   *
   * The clear has to ride this write rather than follow it: an `approved`
   * week with no snapshot, or a `submitted` week still wearing
   * `gross_minor`/`approved_by`, is exactly the inconsistency migration 042's
   * header forbids, and a second statement is a window in which it exists.
   *
   * The version predicate covers the race the status cannot see: between the
   * service's read and this write, another parent can reopen and re-approve,
   * and a status-only predicate would then discard a snapshot frozen against
   * a decision this reopen never saw.
   *
   * `query_note` is deliberately NOT cleared — an undo-approve says nothing
   * about whether a question is outstanding, and `ParentWeekView` renders
   * that column as an open dispute.
   */
  async reopenFromApproved(
    timesheetId: string,
    expectedUpdatedAt: string,
    reason: string
  ): Promise<TimesheetRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        reopen_reason: reason,
        ...CLEARED_EARNINGS_SNAPSHOT,
      })
      .eq('id', timesheetId)
      .eq('status', REOPENABLE_FROM)
      .eq('updated_at', expectedUpdatedAt)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to reopen timesheet', 'DATABASE_ERROR', {
        details: error.message,
        timesheetId,
      });
    }
    return data as TimesheetRow | null;
  }

  /**
   * Whether ANY timesheet has ever been recorded for a household — the
   * household domain's `week_starts_on` lock guard (it defines pay-week
   * boundaries, so it may not move once a week has been recorded against the
   * old one). Same head/count shape as `timeEntryRepository.hasTimeEntries`.
   */
  async existsForHousehold(householdId: string): Promise<boolean> {
    const { count, error } = await supabaseService
      .from(this.table)
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId);

    if (error) {
      throw new DatabaseError(
        'Failed to check timesheets for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (count ?? 0) > 0;
  }
}
