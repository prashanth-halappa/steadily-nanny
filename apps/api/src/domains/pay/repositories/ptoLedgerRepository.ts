/**
 * PTO ledger repository — data access for the append-only `pto_ledger`
 * table (supabase/migrations/043_pto_ledger.sql). Extends BaseRepository for
 * `findById`; `create` is OVERRIDDEN (not the inherited plain insert) to
 * translate the table's two partial unique indexes into typed domain errors
 * instead of a raw 500 — see its doc below. There is no RLS behind D1: authorization lives in the SERVICE layer, never
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
import { and, asc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { carerTimeOff, ptoLedger } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import {
  PtoAccrualGrantRaceError,
  PtoAlreadyMarkedPaidError,
  PtoTimeOffNotConfirmedError,
  PtoTimeOffNotFoundError,
} from '../errors/payErrors';

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

/** The arguments of `applyCorrection` (the old `apply_pto_correction` RPC). */
export interface ApplyPtoCorrectionArgs {
  householdId: string;
  timeOffId: string;
  expected: PtoPaidByDate;
  rows: readonly NewPtoLedgerRow[];
  /** Refuse (rather than write) unless the time off is still `confirmed`. */
  requireConfirmed: boolean;
}

const asEntries = (rows: unknown[]) => rows as PtoLedgerEntry[];

/**
 * The canonical form of a paid-minutes-by-day map: keys sorted, compact JSON.
 * Must match, byte for byte, what `ledgerFingerprint` below makes SQLite emit
 * (pinned by a unit test), because the correction guard compares the two.
 */
export function canonicalPaidByDate(paid: PtoPaidByDate): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(paid).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
  );
}

/** The ledger's current paid-by-day map for one time off, as canonical JSON. */
const ledgerFingerprint = (householdId: string, timeOffId: string): SQL =>
  sql`(SELECT coalesce(json_group_object(d, -m), '{}') FROM (SELECT effective_date AS d, sum(minutes) AS m FROM pto_ledger WHERE household_id = ${householdId} AND time_off_id = ${timeOffId} GROUP BY effective_date ORDER BY effective_date))`;

export class PtoLedgerRepository extends BaseRepository<
  PtoLedgerEntry,
  typeof ptoLedger
> {
  constructor() {
    super(ptoLedger);
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
    try {
      return asEntries(
        await db
          .select()
          .from(ptoLedger)
          .where(
            and(
              eq(ptoLedger.household_id, householdId),
              eq(ptoLedger.carer_id, carerId),
              gte(ptoLedger.effective_date, `${year}-01-01`),
              lte(ptoLedger.effective_date, `${year}-12-31`)
            )
          )
          .orderBy(asc(ptoLedger.effective_date), asc(ptoLedger.created_at))
      );
    } catch (err) {
      throw this.dbError('Failed to list carer year of', err, {
        householdId,
        carerId,
        year,
      });
    }
  }

  /**
   * EVERY carer's ledger rows for one household in one CALENDAR year —
   * `listForCarerYear` with the `carer_id` filter deliberately absent.
   *
   * WHY IT EXISTS: 033 NULLs `carer_id` when a carer deletes her account and
   * keeps the ledger row, and every PTO route until now required a `carerId`
   * in the URL. So a departed carer's accrued/used/adjusted minutes — the
   * record of leave a family may still owe, or have already paid — had no API
   * address at all. Rows are returned with `carer_id`, `household_member_id`
   * and the `carer_display_name` snapshot intact; grouping them is the
   * caller's job (`carerKeyOf`), because only the caller knows whether it is
   * rendering one carer or a whole household.
   *
   * NO LAZY GRANT ON THIS PATH, unlike `ptoQueryService.balance`/`ledger`:
   * granting a year for every carer a household has ever had — including ones
   * whose accounts are gone — would mint permanent, un-re-grantable accrual
   * rows nobody asked for (043's partial unique index makes them permanent).
   * This read is a read.
   */
  async listForHouseholdYear(
    householdId: string,
    year: number
  ): Promise<PtoLedgerEntry[]> {
    try {
      return asEntries(
        await db
          .select()
          .from(ptoLedger)
          .where(
            and(
              eq(ptoLedger.household_id, householdId),
              gte(ptoLedger.effective_date, `${year}-01-01`),
              lte(ptoLedger.effective_date, `${year}-12-31`)
            )
          )
          .orderBy(asc(ptoLedger.effective_date), asc(ptoLedger.created_at))
      );
    } catch (err) {
      throw this.dbError('Failed to list household year of', err, {
        householdId,
        year,
      });
    }
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
    try {
      return asEntries(
        await db
          .select()
          .from(ptoLedger)
          .where(
            and(
              eq(ptoLedger.household_id, householdId),
              eq(ptoLedger.time_off_id, timeOffId)
            )
          )
      );
    } catch (err) {
      throw this.dbError('Failed to look up time off rows in', err, {
        householdId,
        timeOffId,
      });
    }
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
    try {
      return asEntries(
        await db
          .select()
          .from(ptoLedger)
          .where(eq(ptoLedger.time_off_id, timeOffId))
      );
    } catch (err) {
      throw this.dbError('Failed to look up cross-household rows in', err, {
        timeOffId,
      });
    }
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
   *   rows are the whole point — so a unique violation there (if it somehow occurred)
   *   falls through to a genuine `DatabaseError`.
   */
  async create(row: NewPtoLedgerRow): Promise<PtoLedgerEntry> {
    try {
      const [created] = await db.insert(ptoLedger).values(row).returning();
      return created as PtoLedgerEntry;
    } catch (err) {
      if (mapDbError(err)?.kind === 'unique') {
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
      throw this.dbError('Failed to create', err, { kind: row.kind });
    }
  }

  /**
   * Append a batch of `adjustment` rows as ONE compare-and-set on the
   * ledger aggregate — the ONLY way a correction or a reversal is written
   * (F-B4-2; the old `apply_pto_correction` RPC, MIGRATION-NOTES §5.5).
   *
   * Sends the caller's INTENT plus the per-day state it computed that intent
   * from. D1 has no row locks, so every insert is an `INSERT … SELECT …
   * WHERE <ledger fingerprint> = <the state just before this row> AND <time
   * off exists / is confirmed> AND <previous row landed>`, and all of them go
   * in one batch: a concurrent writer moves the fingerprint and NOTHING
   * lands — so two parents correcting 8h → 6h at the same instant can no
   * longer both subtract 2h from the same stale 8h and land on 4h. Zero rows
   * written is then re-read and classified into the RPC's outcomes; the typed
   * domain errors are thrown here.
   *
   * Returns the rows written, or `null` when the ledger MOVED under the write
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
    const meta = { householdId: args.householdId, timeOffId: args.timeOffId };
    // Row k is gated on the ledger fingerprint the state must have just
    // before it: fp_0 is the caller's expected map, fp_k folds in row k.
    const paid: Record<string, number> = { ...args.expected };
    const ids: string[] = [];
    const inserts = args.rows.map(row => {
      const before = canonicalPaidByDate(paid);
      paid[row.effective_date] = (paid[row.effective_date] ?? 0) - row.minutes;
      const id = crypto.randomUUID();
      // Chain on the previous row too, so a concurrent writer that happens to
      // leave the ledger at fp_{k-1} cannot land a suffix without row 1.
      const prevId = ids.at(-1);
      ids.push(id);
      const value = <T>(v: T, column: string) => sql<T>`${v}`.as(column);
      // FROM the time off row: household_id and time_off_id come from the
      // arguments, and leave_kind (079) from carer_time_off in the same
      // statement — never from the row, so no caller can label its own draw.
      return db.insert(ptoLedger).select(
        db
          .select({
            id: value(id, 'id'),
            household_id: value(args.householdId, 'household_id'),
            carer_id: value(row.carer_id, 'carer_id'),
            kind: value(row.kind, 'kind'),
            minutes: value(row.minutes, 'minutes'),
            effective_date: value(row.effective_date, 'effective_date'),
            time_off_id: carerTimeOff.id,
            carer_display_name: value(
              row.carer_display_name,
              'carer_display_name'
            ),
            note: value(row.note, 'note'),
            created_by: value(row.created_by, 'created_by'),
            // Insert-select must list every column, in table order.
            created_at: value(new Date().toISOString(), 'created_at'),
            household_member_id: value(null, 'household_member_id'),
            leave_kind: carerTimeOff.kind,
          })
          .from(carerTimeOff)
          .where(
            and(
              eq(carerTimeOff.id, args.timeOffId),
              args.requireConfirmed
                ? eq(carerTimeOff.status, 'confirmed')
                : undefined,
              sql`${ledgerFingerprint(args.householdId, args.timeOffId)} = ${before}`,
              prevId
                ? sql`EXISTS (SELECT 1 FROM pto_ledger WHERE id = ${prevId})`
                : undefined
            )
          )
      );
    });

    try {
      const [first, ...rest] = inserts;
      if (first) {
        const results = await db.batch([first, ...rest]);
        // Each insert is gated on its predecessor having landed, so either all
        // land or none do. `> 0`, not `=== 1`: meta.changes also counts the
        // household_member_id stamp trigger's write.
        const landed = results.filter(r => r.meta.changes > 0).length;
        if (landed === ids.length) {
          return asEntries(
            await db
              .select()
              .from(ptoLedger)
              .where(inArray(ptoLedger.id, ids))
              .orderBy(asc(ptoLedger.effective_date))
          );
        }
        if (landed !== 0) {
          // Unreachable by construction; refusing beats guessing.
          throw new DatabaseError(
            'PTO correction partially applied',
            'DATABASE_ERROR',
            { ...meta, landed, expected: ids.length }
          );
        }
      }
    } catch (err) {
      if (err instanceof DatabaseError) throw err;
      throw this.dbError('Failed to apply correction to', err, meta);
    }

    // Nothing landed (or there was nothing to write): re-read and answer what
    // the RPC would have — its typed refusals throw; a moved ledger is `null`
    // (the caller recomputes and retries); an empty write against an
    // unchanged ledger is `applied` with no rows.
    const state = await this.classifyCorrectionRefusal(args);
    return state === 'ok' && ids.length === 0 ? [] : null;
  }

  /**
   * Re-read after a correction wrote nothing: throws the RPC's typed refusals
   * (`time_off_not_found`, `not_confirmed`), else says whether the ledger has
   * moved off `expected` (`stale`) or not (`ok` — the batch lost a race that
   * has since settled back, which the caller treats like `stale` and retries).
   */
  private async classifyCorrectionRefusal(
    args: ApplyPtoCorrectionArgs
  ): Promise<'stale' | 'ok'> {
    let row: { status: string; fingerprint: string } | undefined;
    try {
      row = await db.get<{ status: string; fingerprint: string }>(
        sql`SELECT status, ${ledgerFingerprint(args.householdId, args.timeOffId)} AS fingerprint FROM carer_time_off WHERE id = ${args.timeOffId}`
      );
    } catch (err) {
      throw this.dbError('Failed to re-read correction state in', err, {
        householdId: args.householdId,
        timeOffId: args.timeOffId,
      });
    }
    if (!row) {
      throw new PtoTimeOffNotFoundError(args.householdId, args.timeOffId, {
        reason: 'time_off_not_found',
      });
    }
    if (args.requireConfirmed && row.status !== 'confirmed') {
      throw new PtoTimeOffNotConfirmedError(args.timeOffId, row.status);
    }
    return row.fingerprint === canonicalPaidByDate(args.expected)
      ? 'ok'
      : 'stale';
  }
}
