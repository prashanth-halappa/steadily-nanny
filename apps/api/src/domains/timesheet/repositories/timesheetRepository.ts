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
  PreviousApproval,
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

/**
 * The approval a row currently carries, shaped for `previous_approval` (111).
 *
 * `null` for anything that is not an approval worth keeping — no row, or a row
 * that was not `approved` in the first place (a lost race, or a caller that
 * checked the status against a stale read). Writing `{approved_at: null, ...}`
 * instead would put an empty receipt on the row that the client would then
 * have to distinguish from a real one.
 *
 * `worked_minutes` is dug out of the frozen `earnings` jsonb rather than taken
 * from `total_minutes`, and the two are NOT interchangeable: `total_minutes`
 * counts every entry including `cancellation_paid`, while the snapshot's
 * `worked_minutes` is the engine's own worked basis. Mixing them produces a
 * plausible, wrong figure on any week with a paid cancellation. `null` when
 * the snapshot has no such key (`no_arrangement`, `currency_change`).
 */
function previousApprovalOf(row: TimesheetRow | null): PreviousApproval | null {
  if (row?.status !== 'approved' || !row.approved_at) {
    return null;
  }
  const earnings = row.earnings;
  const worked =
    earnings && typeof earnings === 'object' && 'worked_minutes' in earnings
      ? (earnings as { worked_minutes?: unknown }).worked_minutes
      : undefined;
  return {
    approved_at: row.approved_at,
    approved_by: row.approved_by,
    gross_minor: row.gross_minor,
    currency: row.currency,
    worked_minutes: typeof worked === 'number' ? worked : null,
  };
}

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
   * The trailing `limit` APPROVED weeks' frozen `gross_minor` for one carer,
   * strictly before `beforeWeekStart`, most recent first — §11.1.1's
   * "trailing four-week median" baseline for the "nothing unusual this week"
   * fast path (`nothingUnusualService.ts`). Reads the already-frozen column,
   * never recomputes: a live estimate for a prior week would drift every
   * time this ran, and the whole point is a stable baseline.
   *
   * Rows with a NULL `gross_minor` (approved before migration 042, never
   * backfilled — same `legacy_approval` case `getWeekWithEarnings` handles)
   * are excluded rather than treated as zero, which would drag the median
   * toward a figure nobody ever earned.
   */
  async recentApprovedGross(
    householdId: string,
    carerId: string,
    beforeWeekStart: string,
    limit: number
  ): Promise<number[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('gross_minor')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .eq('status', 'approved')
      .lt('week_start', beforeWeekStart)
      .not('gross_minor', 'is', null)
      .order('week_start', { ascending: false })
      .limit(limit);

    if (error) {
      throw new DatabaseError(
        'Failed to list recent approved gross for carer',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId, beforeWeekStart }
      );
    }
    return ((data ?? []) as { gross_minor: number | null }[])
      .map(row => row.gross_minor)
      .filter((value): value is number => value !== null);
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
   * (017 → `public.set_updated_at`; 100 → timesheets-own
   * `public.set_timesheets_updated_at`, which preserves `OLD.updated_at` for a
   * `parent_viewed_at`-only write and still bumps every other update), which
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
        // Cleared for the same reason `query_note` and `reopen_reason` are:
        // it is display state about a week whose approved total no longer
        // covered every hour worked, and this approval is the parent looking
        // at the new total and signing it off. Leaving it set would keep
        // telling both sides "hours were added after payment" about a figure
        // that now includes them — the stale-note bug class, in a money-
        // adjacent column (102).
        hours_changed_after_payment_at: null,
        // Same reason again, one column over (111): `previous_approval` is
        // the receipt for an approval this week LOST. This write is a new
        // approval, and it SUPERSEDES the old one — the figures the parent
        // is signing off now are on the row itself. Leaving the receipt set
        // would have `ApproveWeekDialog` offering to replace a total that
        // has already been replaced.
        previous_approval: null,
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
   * THE CLOCK-OUT'S ONE WRITE — `roll_up_timesheet_hours` (migration 102).
   *
   * It is an RPC, not an update, and neither half of that is optional:
   *
   * - **It has to consult `payments`.** Clearing an approved week's
   *   `gross_minor` is what every payment recorded against that week was
   *   bounded by (077). Doing it without looking is gap P1: the balance goes
   *   negative and `payments` is append-only, so nothing takes those rows
   *   back. A week nobody has paid still demotes to `submitted` with the
   *   snapshot cleared — D1's rule, unchanged. A PAID week keeps its status,
   *   its approver and all four snapshot columns, records the minutes, and
   *   gets `hours_changed_after_payment_at` stamped instead.
   * - **The consulting has to happen inside the lock.** A read here followed
   *   by a conditional update is the identical TOCTOU one level up, and even
   *   in SQL an `exists` subquery inside an UPDATE reads the STATEMENT
   *   snapshot — taken before the row lock was granted — so a payment that
   *   committed while the statement queued would be invisible and the week
   *   would be demoted out from under it anyway. plpgsql after
   *   `select ... for update` sees what the winner committed. 077's rule,
   *   applied to the other side of the same lock.
   *
   * A CLOCK-OUT MUST NEVER FAIL, so there is no compare-and-swap here and no
   * lost-race null to handle: the hours happened and have to be recorded. The
   * caller reads the RETURNED row's status to decide whether the week moved.
   *
   * `single()` rather than `maybeSingle()`: the caller has already found this
   * timesheet, and a roll-up that matched nothing means the row vanished
   * mid-write, which is a real failure rather than a race to absorb.
   */
  async rollUpHours(
    timesheetId: string,
    totalMinutes: number
  ): Promise<TimesheetRow> {
    const { data, error } = await supabaseService
      .rpc('roll_up_timesheet_hours', {
        p_timesheet_id: timesheetId,
        p_total_minutes: totalMinutes,
      })
      .single();

    if (error || !data) {
      throw new DatabaseError(
        'Failed to roll hours into timesheet',
        'DATABASE_ERROR',
        { details: error?.message, timesheetId }
      );
    }
    return data as TimesheetRow;
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
   *
   * `previous_approval` IS written (111), from a read taken here. The
   * clock-out's demote branch gets this for free — `roll_up_timesheet_hours`
   * reads the OLD values off the right-hand side of its own `SET` — but a
   * PostgREST update has no `OLD` to reference, so the values have to be read
   * before the write. That read cannot go stale: the CAS below pins
   * `updated_at` to `expectedUpdatedAt`, so the write lands only against the
   * row version the SERVICE read, and any row carrying that version carries
   * these exact four values. A row that moved underneath us fails the CAS and
   * writes nothing at all rather than writing a receipt for the wrong figures.
   * `reopen_reason` alone carries no figures, and the parent's own undo
   * deserves the same legibility the clock-out's demotion now has.
   */
  async reopenFromApproved(
    timesheetId: string,
    expectedUpdatedAt: string,
    reason: string
  ): Promise<TimesheetRow | null> {
    // BEST-EFFORT, like the `timesheet_reopened` day-thread append the caller
    // makes right after this. `previous_approval` is display state; a read
    // that fails must not turn a parent's undo into a 500. The column is null
    // on every `approved` row (approve clears it), so writing null here is a
    // no-op rather than an erasure.
    const previous = await this.findById(timesheetId).catch(() => null);
    const { data, error } = await supabaseService
      .from(this.table)
      .update({
        status: 'submitted',
        approved_by: null,
        approved_at: null,
        reopen_reason: reason,
        previous_approval: previousApprovalOf(previous),
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
   * One-way Hours receipt. `.is('parent_viewed_at', null)` makes this one-way
   * in the database rather than in a service branch: the FIRST open wins and
   * every later one matches nothing, so the timestamp answers "did this
   * reach them" and can never drift into "when did they last look at it" —
   * whether, never how many times (100's column comment; mirrors 092).
   *
   * Returns null when there was nothing to stamp, which the caller reads as
   * "already viewed", not as an error.
   *
   * A write of ONLY this column must not bump `updated_at`: approve's
   * compare-and-swap pins the row version, and the timesheets-own trigger
   * (`set_timesheets_updated_at`, migration 100) preserves `OLD.updated_at`
   * for a receipt-only write. See GOLDEN-FIXES.
   */
  async stampParentViewed(
    id: string,
    viewedAt: string
  ): Promise<TimesheetRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ parent_viewed_at: viewedAt })
      .eq('id', id)
      .is('parent_viewed_at', null)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to stamp timesheet as viewed',
        'DATABASE_ERROR',
        { details: error.message, id }
      );
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
