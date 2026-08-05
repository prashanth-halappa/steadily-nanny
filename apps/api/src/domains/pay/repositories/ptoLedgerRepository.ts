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
   * indexes (043's header) into typed domain errors instead of a raw 500 —
   * disambiguated by `row.kind`, since each index only ever guards inserts
   * of ONE kind:
   *
   * - `kind: 'usage'` hitting `pto_ledger_one_usage_per_time_off_idx` means
   *   this exact time off is ALREADY marked paid in this household —
   *   `PtoAlreadyMarkedPaidError`, which `ptoCommandService.markTimeOffPaid`
   *   surfaces to the caller rather than double-paying.
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
}
