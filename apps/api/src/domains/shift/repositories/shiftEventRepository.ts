/**
 * Shift-event repository — access to the `shift_events` append-only day
 * thread. Reads are the primary purpose; the one write path is the
 * idempotent bulk-append pair below (`listEventKeysForDate` + `insertMany`),
 * which callers use to append an event without ever double-raising the same
 * `payload.key`:
 *   - the child domain's `uncoveredCareService.raiseUncoveredOnce`
 *     (`uncovered_care`), and
 *   - the schedule domain's `scheduleMaterialisationService`
 *     (`pattern_conflict`) — re-materialisation re-expands every pattern from
 *     `dtstart` on every horizon run, so an unkeyed append would grow this
 *     table without bound.
 * Keyed events are deduped at two layers: the caller's pre-insert key filter,
 * and migration 025's partial EXPRESSION unique index — which PostgREST's
 * `ignoreDuplicates` can't target directly (see `insertMany`'s doc), so a
 * concurrent duplicate 23505s the batch and `insertMany` retries row by row
 * to make the loser attributable and skip only it.
 * Still append-only: there is NO update/delete method anywhere here,
 * matching the DB's policy: an editable audit trail is not an audit trail
 * (see supabase/migrations/015_shifts.sql).
 *
 * @module domains/shift/repositories/shiftEventRepository
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';

/** One row to append. `shift_id` is nullable for day-level events (see migration 015). */
export interface NewShiftEventInput {
  household_id: string;
  shift_id: string | null;
  local_date: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
}

const UNIQUE_VIOLATION = '23505';
/** Migration 025's partial expression index — the name a per-row 23505 is matched on. */
const KEYED_UNIQUE_INDEX = 'shift_events_keyed_unique_idx';

/**
 * Whether a Postgres error is 025's keyed-event collision. Matched on the
 * CONSTRAINT NAME, not the bare code — a future second unique index on this
 * table would also 23505, and treating that as "already exists, skip" would
 * silently swallow a real bug as a lost race. Same shape as
 * `scheduleShiftRepository.isRecurringWindowCollision`.
 */
function isKeyedDuplicate(error: {
  code?: string;
  message: string;
  details?: string | null;
}): boolean {
  return (
    error.code === UNIQUE_VIOLATION &&
    `${error.message} ${error.details ?? ''}`.includes(KEYED_UNIQUE_INDEX)
  );
}

export class ShiftEventRepository {
  private readonly table = 'shift_events';

  /** The day-thread entries tied to one shift, oldest first. */
  async listForShift(
    householdId: string,
    shiftId: string
  ): Promise<ShiftEvent[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError('Failed to list shift events', 'DATABASE_ERROR', {
        details: error.message,
        householdId,
        shiftId,
      });
    }
    return (data ?? []) as ShiftEvent[];
  }

  /**
   * Day-level thread for a household calendar date — includes rows with
   * nullable `shift_id` (D24). Distinct from `listForShift`, which stays
   * shift-scoped and never silently widens.
   */
  async listForHouseholdDate(
    householdId: string,
    localDate: string
  ): Promise<ShiftEvent[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('local_date', localDate)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list day-thread events',
        'DATABASE_ERROR',
        { details: error.message, householdId, localDate }
      );
    }
    return (data ?? []) as ShiftEvent[];
  }

  /**
   * The `payload.key` values already raised for this household/date/
   * event_type — the de-dupe set an idempotent raiser (e.g.
   * `coverageGapService.raiseGapsOnce`,
   * `scheduleMaterialisationService`'s `pattern_conflict`) checks BEFORE
   * inserting, so re-running never doubles up the day thread. Migration 025
   * adds a partial unique index as a backstop for concurrent writers.
   */
  async listEventKeysForDate(
    householdId: string,
    localDate: string,
    eventType: string
  ): Promise<Set<string>> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('payload')
      .eq('household_id', householdId)
      .eq('local_date', localDate)
      .eq('event_type', eventType);

    if (error) {
      throw new DatabaseError(
        'Failed to list existing shift event keys',
        'DATABASE_ERROR',
        { details: error.message, householdId, localDate, eventType }
      );
    }
    const rows = (data ?? []) as { payload: Record<string, unknown> }[];
    return new Set(
      rows
        .map(row => row.payload?.key)
        .filter((key): key is string => typeof key === 'string')
    );
  }

  /**
   * Bulk append with keyed-event dedupe. Callers (e.g. `coverageGapService.
   * raiseGapsOnce`) are expected to have already filtered out any
   * `payload.key` returned by `listEventKeysForDate`; this method upserts
   * with `ignoreDuplicates` so a plain-column/PK conflict is skipped inline.
   *
   * BUT migration 025's dedupe is a partial EXPRESSION index —
   * `(household_id, local_date, event_type, (payload->>'key'))` — and
   * PostgREST's `onConflict` option only accepts a column-name list, which
   * cannot name an expression index. Without a matching `onConflict`,
   * `ignoreDuplicates` does NOT apply to this index: a concurrent
   * duplicate-keyed row makes the whole batch 23505-THROW instead of being
   * silently skipped (verified against local PostgREST 14.15 — reopens
   * F-B6-5; the prior version of this comment claimed the opposite from an
   * unreproducible manual check and was wrong). On that specific error, retry
   * row by row — same precedent as `ScheduleShiftRepository.createMany`
   * (GOLDEN-FIXES #28): a multi-row statement aborts wholesale without saying
   * which row lost, so per-row retry is what makes the loser attributable. A
   * per-row 23505 matching `KEYED_UNIQUE_INDEX` by name (not bare code — see
   * `isKeyedDuplicate`) means a concurrent writer already raised that exact
   * key — expected, skip it, not an error. A 23505 on some OTHER index is a
   * real bug, not a lost race, and still throws.
   *
   * Returns the rows THIS call genuinely created (never the ones skipped,
   * batch or per-row) — a caller must not act as if it created a row it
   * merely lost the race on (F-B6-5).
   */
  async insertMany(events: NewShiftEventInput[]): Promise<ShiftEvent[]> {
    if (events.length === 0) {
      return [];
    }
    const { data, error } = await supabaseService
      .from(this.table)
      .upsert(events, { ignoreDuplicates: true })
      .select();

    if (!error) {
      return (data ?? []) as ShiftEvent[];
    }
    if (error.code !== UNIQUE_VIOLATION) {
      throw new DatabaseError(
        'Failed to insert shift events',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }

    const created: ShiftEvent[] = [];
    for (const event of events) {
      const { data: row, error: rowError } = await supabaseService
        .from(this.table)
        .insert(event)
        .select()
        .single();

      if (rowError) {
        if (isKeyedDuplicate(rowError)) {
          continue; // a concurrent writer already raised this exact key
        }
        throw new DatabaseError(
          'Failed to insert shift events',
          'DATABASE_ERROR',
          { details: rowError.message }
        );
      }
      created.push(row as ShiftEvent);
    }
    return created;
  }

  /**
   * S8 retention — the ONLY delete on this table, and it is allowlisted.
   *
   * `shift_events` grows without bound: the nightly sweep writes an
   * `uncovered_care` row per uncovered window per household per day across a
   * 30-day horizon, and `pattern_conflict` re-fires on every re-materialisation.
   * Those rows are MACHINE OUTPUT — keyed, deduped, `actor_id` null, and
   * recomputed from live data by every surface that renders them
   * (docs/12-NEED-COVERAGE.md §4: "compute live; do not accumulate"). Deleting
   * an old one destroys no evidence, because the row was never the source of
   * truth for anything.
   *
   * `types` IS AN ALLOWLIST AND MUST STAY ONE. A denylist ("delete everything
   * except the thread types") would make every event type added after this
   * line silently deletable, including the next dispute-bearing one. The
   * append-only guarantee that matters — no UPDATE and no DELETE policy on the
   * table, so nothing but the service role can touch it, and the day thread and
   * the 3-T1 week thread are untouchable through every normal path — is
   * unchanged: this method adds no policy, it is one service-role sweep with a
   * hardcoded set of machine-generated types.
   *
   * NEVER add `timesheet_queried`, `timesheet_note_added`,
   * `timesheet_query_withdrawn` (the week thread — the dispute record D-18/D-19
   * exist for), `shift_cancelled` (it carries the cancellation-pay verdict),
   * or any `change_request_*` row to that set.
   */
  async deleteSweptEventsOlderThan(
    cutoffIso: string,
    types: readonly string[]
  ): Promise<number> {
    if (types.length === 0) {
      return 0;
    }
    const { data, error } = await supabaseService
      .from(this.table)
      .delete()
      .in('event_type', [...types])
      .lt('created_at', cutoffIso)
      .select('id');

    if (error) {
      throw new DatabaseError(
        'Failed to sweep old shift events',
        'DATABASE_ERROR',
        { details: error.message, cutoffIso }
      );
    }
    return (data ?? []).length;
  }
}
