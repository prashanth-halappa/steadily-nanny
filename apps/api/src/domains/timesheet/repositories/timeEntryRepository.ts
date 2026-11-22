/**
 * Time-entry repository — data access for the `time_entries` table. Extends
 * BaseRepository for standard CRUD and adds the domain queries the
 * clock-in/out flow needs, plus `hasTimeEntries`, which is the one method
 * consumed OUTSIDE this domain — by `scheduleMaterialisationService`'s
 * `TimeEntryExistenceRepository` dependency, so a shift someone has clocked
 * into is never rewritten by re-materialisation. Talks to D1 through
 * Drizzle with no row-level security, so ownership/authorization is enforced
 * in the SERVICE layer, never here.
 *
 * `local_date` is NOT NULL and no longer trigger-filled (Postgres's
 * `sync_time_entries_local_date`, MIGRATION-NOTES §4): every insert here, and
 * every `update` touching `clock_in_at` / `clock_out_at` / `timezone`, sets it
 * via `timeEntryLocalDate`, so services never have to.
 *
 * @module domains/timesheet/repositories/timeEntryRepository
 */
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { timeEntryLocalDate } from '../../../db/localDate';
import { timeEntries } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import {
  AlreadyClockedInError,
  CancellationPaidAlreadyRecordedError,
} from '../errors/timesheetErrors';

/** Below D1's 100-bound-parameter cap per statement. */
const IN_CHUNK = 90;

const notVoided = ne(timeEntries.status, 'voided');

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
  // The instant the app watched the tap — the same value as `clock_in_at` at
  // insert, and frozen there while `clock_in_at` stays correctable. See 113's
  // header. Omit it and the row reads as "not observed", which is right only
  // for entries nobody tapped.
  observed_clock_in_at?: string | null;
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
  // Both OMITTED on every path that writes a row the app never watched — a
  // retroactive entry and a cancellation-pay row are claims, not observations,
  // and their null is what distinguishes them from a real clock-out (113).
  // The one caller that sets `observed_clock_out_at` is `clockOutAcrossWeeks`,
  // for fragment B alone: fragment B OPENS at a computed boundary and CLOSES
  // at the real tap, so exactly one of its ends is an observation.
  observed_clock_in_at?: string | null;
  observed_clock_out_at?: string | null;
  break_minutes: number;
  scheduled_minutes: number | null;
  timezone: string;
  kind: TimeEntry['kind'];
  status: 'submitted';
  note?: string | null;
}

export class TimeEntryRepository extends BaseRepository<
  TimeEntry,
  typeof timeEntries
> {
  constructor() {
    super(timeEntries);
  }

  /** Insert with `local_date` derived from the row itself (clock_in_at wins). */
  private async insertOne(
    data: NewTimeEntryData | NewSubmittedTimeEntryData
  ): Promise<TimeEntry> {
    const rows = await db
      .insert(timeEntries)
      .values({ ...data, local_date: timeEntryLocalDate(data, data.timezone) })
      .returning();
    return rows[0] as TimeEntry;
  }

  /**
   * Base `update`, plus the `local_date` re-derivation the Postgres trigger
   * did on any change to `clock_in_at` / `clock_out_at` / `timezone`. Columns
   * the patch omits come from the current row, so a clock-out after midnight
   * keeps the clock-in day (clock_in_at wins the coalesce).
   *
   * ponytail: read-then-write, so a concurrent clock edit between the two
   * could leave local_date derived from the older clock_in_at. Every caller
   * already holds the row it just read; pass it in if that ever matters.
   */
  override async update(
    id: string,
    data: Partial<TimeEntry>
  ): Promise<TimeEntry> {
    if (
      !('clock_in_at' in data || 'clock_out_at' in data || 'timezone' in data)
    ) {
      return super.update(id, data);
    }
    const current = await this.findById(id);
    if (!current) return super.update(id, data); // throws the no-row error
    const next = { ...current, ...data };
    return super.update(id, {
      ...data,
      local_date: timeEntryLocalDate(next, next.timezone),
    });
  }

  /**
   * Start a clock-in. Translates the DB's
   * `time_entries_one_running_per_carer` partial unique index into a
   * clean AlreadyClockedInError instead of a raw 500 — the defence against a
   * double clock-in racing past the service-level pre-check in
   * `timesheetCommandService.clockIn`.
   */
  async clockIn(data: NewTimeEntryData): Promise<TimeEntry> {
    try {
      return await this.insertOne(data);
    } catch (err) {
      if (mapDbError(err)?.kind === 'unique') {
        throw new AlreadyClockedInError(data.carer_id);
      }
      throw this.dbError('Failed to clock in on', err, {
        operation: 'clockIn',
      });
    }
  }

  /**
   * Insert a finished (already clocked-out) entry. Used by forgotten-clock-in
   * recovery and cancellation-pay recording — neither path has a `running`
   * phase, so this does not share `clockIn`'s one-running-per-carer unique
   * translation.
   *
   * For `kind = 'cancellation_paid'`, a unique violation on
   * `time_entries_one_cancellation_paid_per_span` (053) becomes
   * `CancellationPaidAlreadyRecordedError` so `recordCancellationPaidEntry`
   * can re-fetch that FRAGMENT's winner by `(shift_id, clock_in_at)`.
   *
   * On D1 a LIVE duplicate trips the BEFORE INSERT
   * `time_entries_no_overlap_per_household` trigger before the unique index is
   * ever consulted, so an overlap whose span winner exists means the same.
   */
  async createSubmitted(data: NewSubmittedTimeEntryData): Promise<TimeEntry> {
    try {
      return await this.insertOne(data);
    } catch (err) {
      const kind = mapDbError(err)?.kind;
      if (
        data.kind === 'cancellation_paid' &&
        data.shift_id &&
        (kind === 'unique' ||
          (kind === 'overlap' &&
            (await this.findCancellationPaidForSpan(
              data.shift_id,
              data.clock_in_at
            ))))
      ) {
        throw new CancellationPaidAlreadyRecordedError(data.shift_id);
      }
      throw this.dbError('Failed to create submitted entry in', err, {
        operation: 'createSubmitted',
      });
    }
  }

  /**
   * Soft-delete one row (`status = 'voided'`). Conditional on the row not
   * already being voided — returns `null` when nothing changed so
   * `voidEntry` can skip a redundant roll-up (BLOCKER 1, twin of
   * `carerTimeOffRepository.cancelById`).
   */
  async voidById(id: string): Promise<TimeEntry | null> {
    try {
      const rows = await db
        .update(timeEntries)
        .set({ status: 'voided' })
        .where(and(eq(timeEntries.id, id), notVoided))
        .returning();
      return (rows[0] as TimeEntry | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to void row in', err, { id });
    }
  }

  /**
   * Whether a shift has ANY `cancellation_paid` entry — the
   * "already settled?" question `cancellationPayReconcileJob` asks.
   *
   * `.limit(1)` is load-bearing since migration 053: the unique index is now
   * `time_entries_one_cancellation_paid_per_span`, keyed on
   * `(shift_id, clock_in_at)`, so a cancelled window that was split around
   * real worked time legitimately has SEVERAL rows.
   *
   * ponytail: answers "at least one exists", not "all fragments exist" — a
   * partially written split still reads as settled here. Callers that must
   * distinguish should re-run `recordCancellationPaidEntry`, which is
   * self-healing and writes only what is missing.
   */
  async findCancellationPaidForShift(
    shiftId: string
  ): Promise<TimeEntry | null> {
    // 069: voided did not happen — a voided row is not pay.
    return this.first(
      'Failed to look up cancellation pay in',
      and(
        eq(timeEntries.shift_id, shiftId),
        eq(timeEntries.kind, 'cancellation_paid'),
        notVoided
      ),
      { shiftId }
    );
  }

  /**
   * The `cancellation_paid` row for ONE fragment of a shift, identified the
   * same way migration 053's unique index identifies it:
   * `(shift_id, clock_in_at)`.
   *
   * This is the unique-violation recovery lookup. A shift-wide fetch was fine when only
   * one such row could exist; with split remainders it could hand back a
   * DIFFERENT fragment than the one whose insert lost the race.
   */
  async findCancellationPaidForSpan(
    shiftId: string,
    clockInAt: string
  ): Promise<TimeEntry | null> {
    // 069: voided is not a successful write — same defence as shift-wide lookup.
    return this.first(
      'Failed to look up cancellation pay span in',
      and(
        eq(timeEntries.shift_id, shiftId),
        eq(timeEntries.kind, 'cancellation_paid'),
        eq(timeEntries.clock_in_at, clockInAt),
        notVoided
      ),
      { shiftId, clockInAt }
    );
  }

  /** The caller's own open (running) entry, or null. At most one can exist per carer. */
  async findRunningForCarer(carerId: string): Promise<TimeEntry | null> {
    return this.first(
      'Failed to look up running entry in',
      and(eq(timeEntries.carer_id, carerId), eq(timeEntries.status, 'running')),
      { carerId }
    );
  }

  /**
   * The carer's open entry IN ONE HOUSEHOLD, or null. Distinct from
   * `findRunningForCarer`, which is global on purpose (the clock-in guard and
   * "my current shift" both want any-household). A caller asking on behalf of
   * ONE family must use this: a nanny works for several households, so the
   * global answer both blocks Family A on a shift at Family B and discloses
   * that the nanny is working elsewhere.
   */
  async findRunningInHousehold(
    householdId: string,
    carerId: string
  ): Promise<TimeEntry | null> {
    return this.first(
      'Failed to look up running entry in',
      and(
        eq(timeEntries.household_id, householdId),
        eq(timeEntries.carer_id, carerId),
        eq(timeEntries.status, 'running')
      ),
      { householdId, carerId }
    );
  }

  /**
   * Every entry for this carer whose CLOCK SPAN could intersect
   * `[fromInclusive, toInclusive]` — the overlap check's source, deliberately
   * NOT `listForCarerWeek`.
   *
   * `local_date` is FROZEN at write time from the row's own `timezone`
   * column, so a week-filtered lookup cannot see an entry that started on the
   * other side of the week boundary and is still running at the instant
   * being checked —
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
   * SQL's comparison semantics staying in lockstep with the domain's. The
   * comparisons are TEXT comparisons of ISO instants (MIGRATION-NOTES §1), so
   * callers pass `toISOString()` values.
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
   * carer_id filter is enough today. The
   * `time_entries_no_clock_overlap_per_carer_*` triggers are the backstop.
   */
  async listOverlapCandidatesForCarer(
    carerId: string,
    fromInclusive: string,
    toInclusive: string
  ): Promise<TimeEntry[]> {
    // 069: voided did not happen — it holds no window, so it must not block
    // re-clock or close a gap in cancellation-pay remainder arithmetic.
    return this.list(
      'Failed to list overlap candidates in',
      and(
        eq(timeEntries.carer_id, carerId),
        lte(timeEntries.clock_in_at, toInclusive),
        or(
          gte(timeEntries.clock_out_at, fromInclusive),
          isNull(timeEntries.clock_out_at)
        ),
        notVoided
      ),
      { carerId, fromInclusive }
    );
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
    return this.list(
      'Failed to list household week in',
      and(
        eq(timeEntries.household_id, householdId),
        gte(timeEntries.local_date, weekStart),
        lt(timeEntries.local_date, weekEndExclusive),
        carerId ? eq(timeEntries.carer_id, carerId) : undefined
      ),
      { householdId, weekStart },
      // Postgres's DESC put NULLs first; SQLite's puts them last.
      sql`${timeEntries.clock_in_at} DESC NULLS FIRST`
    );
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
    return this.list(
      'Failed to list carer week in',
      and(
        eq(timeEntries.household_id, householdId),
        eq(timeEntries.carer_id, carerId),
        gte(timeEntries.local_date, weekStart),
        lt(timeEntries.local_date, weekEndExclusive)
      ),
      { householdId, carerId, weekStart }
    );
  }

  /**
   * Which of `shiftIds` have EVER had a time entry recorded against them —
   * the "paid-for reality is immutable" probe `scheduleMaterialisationService`
   * runs ONCE for a whole materialisation run. Asking per shift meant one
   * round trip per day of the horizon; the `time_entries_shift_idx` index
   * serves the `IN` form just as well. Chunked under D1's 100-parameter cap.
   */
  async shiftIdsWithTimeEntries(shiftIds: string[]): Promise<Set<string>> {
    if (shiftIds.length === 0) {
      return new Set();
    }
    // 069: voided did not happen, so a shift whose only entries are voided is
    // not "paid-for reality" and must become mutable again. The filter is the
    // DB's job — the select returns rows with no `status` to inspect.
    const found = new Set<string>();
    try {
      for (let i = 0; i < shiftIds.length; i += IN_CHUNK) {
        const rows = await db
          .select({ shift_id: timeEntries.shift_id })
          .from(timeEntries)
          .where(
            and(
              inArray(timeEntries.shift_id, shiftIds.slice(i, i + IN_CHUNK)),
              notVoided
            )
          );
        for (const row of rows) if (row.shift_id) found.add(row.shift_id);
      }
    } catch (err) {
      throw this.dbError('Failed to check shifts in', err, {
        count: shiftIds.length,
      });
    }
    return found;
  }

  /**
   * Whether ANY time entry has ever been recorded against `shiftId` — the
   * single-shift form, used by `shiftRepository`'s delete guard (see
   * `time_entries_shift_idx`, sized for exactly this query).
   */
  async hasTimeEntries(shiftId: string): Promise<boolean> {
    const row = await this.first(
      'Failed to check shift in',
      and(eq(timeEntries.shift_id, shiftId), notVoided),
      { shiftId }
    );
    return row !== null;
  }

  private async list(
    message: string,
    where: SQL | undefined,
    metadata: Record<string, unknown>,
    orderBy?: SQL
  ): Promise<TimeEntry[]> {
    try {
      const query = db.select().from(timeEntries).where(where);
      return (await (orderBy ? query.orderBy(orderBy) : query)) as TimeEntry[];
    } catch (err) {
      throw this.dbError(message, err, metadata);
    }
  }

  private async first(
    message: string,
    where: SQL | undefined,
    metadata: Record<string, unknown>
  ): Promise<TimeEntry | null> {
    try {
      const rows = await db.select().from(timeEntries).where(where).limit(1);
      return (rows[0] as TimeEntry | undefined) ?? null;
    } catch (err) {
      throw this.dbError(message, err, metadata);
    }
  }
}
