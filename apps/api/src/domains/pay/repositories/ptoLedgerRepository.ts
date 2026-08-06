/**
 * PTO ledger repository — data access for the append-only `pto_ledger`
 * table (supabase/migrations/043_pto_ledger.sql). Extends BaseRepository for
 * `findById`; `create` is OVERRIDDEN (not the inherited plain insert) to
 * translate the table's two partial unique indexes into typed domain errors
 * instead of a raw 500 — see its doc below. Uses the service-role client, so
 * it bypasses RLS entirely: authorization lives in the SERVICE layer, never
 * here (docs/11-MONEY.md §9). Every query below therefore filters
 * `household_id` AND, where the resource has one, `carer_id` explicitly —
 * this repository has no RLS backstop of its own. The one deliberate
 * exception is `findAllUsageForTimeOff`, documented at its own definition.
 *
 * There is deliberately NO update or delete helper: the ledger is
 * append-only, and a correction is a new `adjustment` row, never a mutation
 * of an existing one (043's header).
 *
 * @module domains/pay/repositories/ptoLedgerRepository
 */
import {
  PTO_LEDGER_KINDS,
  type PtoLedgerEntry,
  type PtoLedgerKind,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import {
  PtoAccrualGrantRaceError,
  PtoAlreadyMarkedPaidError,
  PtoTimeOffNotConfirmedError,
  PtoTimeOffNotFoundError,
} from '../errors/payErrors';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

/** The insertable shape of a new ledger row — every field a caller must supply. */
export interface NewPtoLedgerRow {
  household_id: string;
  carer_id: string | null;
  kind: PtoLedgerKind;
  minutes: number;
  effective_date: string;
  time_off_id: string | null;
  carer_display_name: string;
  note: string | null;
  created_by: string | null;
}

/**
 * What ONE household has paid for one time off, per household-local day, in
 * POSITIVE minutes (`-sum(minutes)`) — the state a correction's deltas were
 * computed from, and what migration 050 compares against under its lock.
 */
export type PtoPaidByDate = Readonly<Record<string, number>>;

/** The arguments of the `apply_pto_correction` RPC, in TS naming. */
export interface ApplyPtoCorrectionArgs {
  householdId: string;
  timeOffId: string;
  expected: PtoPaidByDate;
  rows: readonly NewPtoLedgerRow[];
  /** Refuse (rather than write) unless the time off is still `confirmed`. */
  requireConfirmed: boolean;
}

/** The RPC's outcome envelope — see `050_serialise_pto_corrections.sql`. */
interface ApplyPtoCorrectionPayload {
  outcome: 'applied' | 'stale' | 'not_confirmed' | 'time_off_not_found';
  rows?: PtoLedgerEntry[];
  current_status?: string;
}

export class PtoLedgerRepository extends BaseRepository<PtoLedgerEntry> {
  constructor() {
    super('pto_ledger');
  }

  /**
   * Every ledger row for one carer in one household whose `effective_date`
   * falls in the given CALENDAR year (owner decision 3: the PTO year is the
   * calendar year for v1) — the window `ptoQueryService.balance`/`ledger`
   * sum to derive entitlement/accrued/used/balance. Both `household_id` AND
   * `carer_id` are filtered explicitly, and the boundaries are inclusive
   * (`gte`/`lte`, not a half-open range) so a same-day accrual/usage row at
   * either edge of the year is never silently dropped.
   */
  async listForCarerYear(
    householdId: string,
    carerId: string,
    year: number
  ): Promise<PtoLedgerEntry[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .gte('effective_date', `${year}-01-01`)
      .lte('effective_date', `${year}-12-31`)
      .order('effective_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list PTO ledger rows for carer year',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId, year }
      );
    }
    return (data ?? []) as PtoLedgerEntry[];
  }

  /**
   * EVERY row THIS household holds against one time off — the `usage` row
   * and all of its `adjustment` corrections. Scoped by `household_id`
   * because a nanny working two families can have an independent marking of
   * the SAME `time_off_id` in each household; this returns only the
   * caller's own.
   *
   * DELIBERATELY UNFILTERED BY `kind` (Phase 3/4 review, BLOCKER 3). What
   * every caller actually needs is the NETTED total this household has paid
   * for the time off — `-sum(minutes)` across usage and adjustments alike.
   * The usage row alone is not that number the moment a correction exists,
   * and reading only the usage row is what let a second mark-paid attempt
   * collide with `pto_ledger_one_usage_per_time_off_idx` instead of
   * appending a delta.
   */
  async listForHouseholdTimeOff(
    householdId: string,
    timeOffId: string
  ): Promise<PtoLedgerEntry[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('time_off_id', timeOffId);

    if (error) {
      throw new DatabaseError(
        'Failed to look up PTO ledger rows for time off',
        'DATABASE_ERROR',
        { details: error.message, householdId, timeOffId }
      );
    }
    return (data ?? []) as PtoLedgerEntry[];
  }

  /**
   * EVERY household's rows for one time off, deliberately UNSCOPED by
   * `household_id` — the one exception to this repository's "filter both
   * ids" rule, and it exists for a structural reason, not carelessness:
   * `reconcileCancelledTimeOff` is invoked with only a `timeOffId` (the
   * availability domain has no household to hand it — `carer_time_off`
   * itself carries none, `011_availability.sql`), and a shared time off can
   * have been marked paid by MULTIPLE households independently (a nanny with
   * two families, each paying its own PTO) — every one of them must be
   * reversed, not just the first found. This never leaks across households:
   * the rows returned here are grouped by `household_id` and fed straight
   * back into THEIR OWN household-scoped `adjustment` inserts, never
   * rendered to a client.
   *
   * Like `listForHouseholdTimeOff`, this is UNFILTERED BY `kind`: reconcile
   * has to see the corrections to know what is still outstanding. Filtering
   * to `usage` was the whole of BLOCKER 1(b) — it made every retry of the
   * fire-and-forget reconciliation write another full reversal.
   */
  async listAllForTimeOff(timeOffId: string): Promise<PtoLedgerEntry[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('time_off_id', timeOffId);

    if (error) {
      throw new DatabaseError(
        'Failed to look up PTO ledger rows across households for time off',
        'DATABASE_ERROR',
        { details: error.message, timeOffId }
      );
    }
    return (data ?? []) as PtoLedgerEntry[];
  }

  /**
   * Append one ledger row. Translates the table's two partial unique
   * indexes (043's header, as amended by 045) into typed domain errors
   * instead of a raw 500 —
   * disambiguated by `row.kind`, since each index only ever guards inserts
   * of ONE kind:
   *
   * - `kind: 'usage'` hitting `pto_ledger_one_usage_per_time_off_day_idx`
   *   (045; 043's per-time-off index until then) means this DAY of this time
   *   off is ALREADY marked paid in this household —
   *   `PtoAlreadyMarkedPaidError`, which `ptoCommandService.markTimeOffPaid`
   *   surfaces to the caller rather than double-paying. Per-day since 045,
   *   because a multi-day marking is one usage row per covered day (review
   *   finding 15b); two concurrent taps still collide, on the first day.
   * - `kind: 'accrual'` hitting `pto_ledger_one_accrual_per_year_idx` means a
   *   concurrent reader raced this one to the lazy annual grant —
   *   `PtoAccrualGrantRaceError`, which `ptoQueryService` catches and
   *   re-reads the winner rather than erroring (the "race re-read, not a
   *   500" rule from the module's own doc).
   * - `kind: 'adjustment'` has no unique index at all — unlimited correction
   *   rows are the whole point — so a 23505 there (if it somehow occurred)
   *   falls through to a genuine `DatabaseError`.
   */
  async create(row: NewPtoLedgerRow): Promise<PtoLedgerEntry> {
    const { data, error } = await supabaseService
      .from(this.table)
      .insert(row)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        if (row.kind === PTO_LEDGER_KINDS.USAGE) {
          throw new PtoAlreadyMarkedPaidError(
            row.household_id,
            row.time_off_id ?? ''
          );
        }
        if (row.kind === PTO_LEDGER_KINDS.ACCRUAL) {
          throw new PtoAccrualGrantRaceError(
            row.household_id,
            row.carer_id ?? '',
            row.effective_date
          );
        }
      }
      throw new DatabaseError(
        'Failed to create PTO ledger row',
        'DATABASE_ERROR',
        { details: error.message, code: error.code, kind: row.kind }
      );
    }
    return data as PtoLedgerEntry;
  }

  /**
   * Append a batch of `adjustment` rows under migration 050's row lock —
   * the ONLY way a correction or a reversal is written (F-B4-2).
   *
   * Sends the caller's INTENT plus the per-day state it computed that intent
   * from. `apply_pto_correction` locks the `carer_time_off` row FOR UPDATE,
   * re-derives that state, and writes only if it still matches — so two
   * parents correcting 8h → 6h at the same instant can no longer both
   * subtract 2h from the same stale 8h and land on 4h. Same shape as
   * `shiftChangeRequestRepository.acceptAndApply`'s: the RPC returns an
   * outcome envelope, and the typed domain errors are mapped here.
   *
   * Returns the rows written, or `null` when the ledger MOVED under the lock
   * — not an error, a signal: the caller must re-read, recompute its deltas
   * from the new state and call again. Writing nothing is a legitimate
   * `applied` result (an empty array), and is how re-submitting an unchanged
   * total stays a no-op.
   *
   * `create` above is deliberately left alone and still writes the FIRST
   * marking's `usage` rows: those are already serialised by 045's per-day
   * partial unique index, which this changes in no way.
   */
  async applyCorrection(
    args: ApplyPtoCorrectionArgs
  ): Promise<PtoLedgerEntry[] | null> {
    const { data, error } = await supabaseService.rpc('apply_pto_correction', {
      p_household_id: args.householdId,
      p_time_off_id: args.timeOffId,
      p_expected: args.expected,
      // household_id, kind and time_off_id are ignored by the function —
      // it takes them from the locked parameters (050's header).
      p_rows: args.rows,
      p_require_confirmed: args.requireConfirmed,
    });

    if (error || !data) {
      throw new DatabaseError(
        'Failed to apply PTO correction',
        'DATABASE_ERROR',
        {
          details: error?.message,
          householdId: args.householdId,
          timeOffId: args.timeOffId,
        }
      );
    }

    const payload = data as ApplyPtoCorrectionPayload;
    if (payload.outcome === 'applied') {
      return payload.rows ?? [];
    }
    if (payload.outcome === 'stale') {
      return null;
    }
    if (payload.outcome === 'not_confirmed') {
      throw new PtoTimeOffNotConfirmedError(
        args.timeOffId,
        payload.current_status ?? 'unknown'
      );
    }
    if (payload.outcome === 'time_off_not_found') {
      throw new PtoTimeOffNotFoundError(args.householdId, args.timeOffId, {
        reason: 'time_off_not_found',
      });
    }

    throw new DatabaseError(
      'Unexpected outcome from apply_pto_correction',
      'DATABASE_ERROR',
      {
        outcome: payload.outcome,
        householdId: args.householdId,
        timeOffId: args.timeOffId,
      }
    );
  }
}
