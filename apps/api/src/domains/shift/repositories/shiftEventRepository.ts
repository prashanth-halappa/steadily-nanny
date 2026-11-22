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
 * and migration 025's partial EXPRESSION unique index — which cannot be an
 * ON CONFLICT target, so a concurrent duplicate fails the batch and
 * `insertMany` retries row by row to make the loser attributable and skip
 * only it.
 * Still append-only: there is NO update/delete method anywhere here,
 * because an editable audit trail is not an audit trail (`shiftEvents` in
 * db/schema/shift.ts; pinned by shiftEventRepository.test.ts).
 *
 * @module domains/shift/repositories/shiftEventRepository
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { chunk, nonEmpty } from '../../../db/chunk';
import { db } from '../../../db/client';
import { shiftEvents } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { isoInstant, isUniqueViolationOn } from '../utils/carerWindowOverlap';

/** One row to append. `shift_id` is nullable for day-level events (see migration 015). */
export interface NewShiftEventInput {
  household_id: string;
  shift_id: string | null;
  local_date: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
}

/** Migration 025's partial expression index — the name a per-row duplicate is matched on. */
const KEYED_UNIQUE_INDEX = 'shift_events_keyed_unique_idx';
/** 7 bound params per row (id, household_id, shift_id, local_date, actor_id, event_type, payload). */
const ROWS_PER_INSERT = 12;

const details = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export class ShiftEventRepository {
  private async list(
    where: ReturnType<typeof and>,
    message: string,
    metadata: Record<string, unknown>
  ): Promise<ShiftEvent[]> {
    try {
      return (await db
        .select()
        .from(shiftEvents)
        .where(where)
        .orderBy(asc(shiftEvents.created_at))) as ShiftEvent[];
    } catch (err) {
      throw new DatabaseError(message, 'DATABASE_ERROR', {
        details: details(err),
        ...metadata,
      });
    }
  }

  /** The day-thread entries tied to one shift, oldest first. */
  async listForShift(
    householdId: string,
    shiftId: string
  ): Promise<ShiftEvent[]> {
    return this.list(
      and(
        eq(shiftEvents.household_id, householdId),
        eq(shiftEvents.shift_id, shiftId)
      ),
      'Failed to list shift events',
      { householdId, shiftId }
    );
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
    return this.list(
      and(
        eq(shiftEvents.household_id, householdId),
        eq(shiftEvents.local_date, localDate)
      ),
      'Failed to list day-thread events',
      { householdId, localDate }
    );
  }

  /**
   * The `payload.key` values already raised for this household/date/
   * event_type — the de-dupe set an idempotent raiser (e.g.
   * `coverageGapService.raiseGapsOnce`,
   * `scheduleMaterialisationService`'s `pattern_conflict`) checks BEFORE
   * inserting, so re-running never doubles up the day thread. Migration 025's
   * partial unique index is the backstop for concurrent writers.
   */
  async listEventKeysForDate(
    householdId: string,
    localDate: string,
    eventType: string
  ): Promise<Set<string>> {
    let rows: { payload: Record<string, unknown> }[];
    try {
      rows = await db
        .select({ payload: shiftEvents.payload })
        .from(shiftEvents)
        .where(
          and(
            eq(shiftEvents.household_id, householdId),
            eq(shiftEvents.local_date, localDate),
            eq(shiftEvents.event_type, eventType)
          )
        );
    } catch (err) {
      throw new DatabaseError(
        'Failed to list existing shift event keys',
        'DATABASE_ERROR',
        { details: details(err), householdId, localDate, eventType }
      );
    }
    return new Set(
      rows
        .map(row => row.payload?.key)
        .filter((key): key is string => typeof key === 'string')
    );
  }

  /**
   * Bulk append with keyed-event dedupe. Callers are expected to have already
   * filtered out any `payload.key` returned by `listEventKeysForDate`.
   *
   * One all-or-nothing D1 batch (chunked under the bound-parameter cap). A
   * concurrent duplicate-keyed row fails the whole batch on 025's expression
   * index, which cannot be an ON CONFLICT target. On that specific error,
   * retry row by row (GOLDEN-FIXES #28): a per-row duplicate on
   * `KEYED_UNIQUE_INDEX` (matched by NAME) means a concurrent writer already
   * raised that exact key — expected, skip it. A violation on any OTHER
   * constraint is a real bug and still throws.
   *
   * Returns the rows THIS call genuinely created (never the ones skipped) — a
   * caller must not act as if it created a row it merely lost the race on
   * (F-B6-5).
   */
  async insertMany(events: NewShiftEventInput[]): Promise<ShiftEvent[]> {
    if (events.length === 0) {
      return [];
    }
    try {
      const pages = await db.batch(
        nonEmpty(
          chunk(events, ROWS_PER_INSERT).map(page =>
            db.insert(shiftEvents).values(page).returning()
          )
        )
      );
      return pages.flat() as ShiftEvent[];
    } catch (err) {
      if (!isUniqueViolationOn(err, KEYED_UNIQUE_INDEX)) {
        throw new DatabaseError(
          'Failed to insert shift events',
          'DATABASE_ERROR',
          { details: details(err) }
        );
      }
    }

    const created: ShiftEvent[] = [];
    for (const event of events) {
      try {
        const [row] = await db.insert(shiftEvents).values(event).returning();
        if (row) created.push(row as ShiftEvent);
      } catch (err) {
        if (isUniqueViolationOn(err, KEYED_UNIQUE_INDEX)) {
          continue; // a concurrent writer already raised this exact key
        }
        throw new DatabaseError(
          'Failed to insert shift events',
          'DATABASE_ERROR',
          { details: details(err) }
        );
      }
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
   * append-only guarantee that matters — no update/delete method anywhere else
   * on this repository, and the day thread and
   * the 3-T1 week thread are untouchable through every normal path — is
   * unchanged: this method adds no policy, it is one sweep with a
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
    try {
      const rows = await db
        .delete(shiftEvents)
        .where(
          and(
            inArray(shiftEvents.event_type, [...types]),
            lt(shiftEvents.created_at, isoInstant(cutoffIso))
          )
        )
        .returning({ id: shiftEvents.id });
      return rows.length;
    } catch (err) {
      throw new DatabaseError(
        'Failed to sweep old shift events',
        'DATABASE_ERROR',
        { details: details(err), cutoffIso }
      );
    }
  }
}
