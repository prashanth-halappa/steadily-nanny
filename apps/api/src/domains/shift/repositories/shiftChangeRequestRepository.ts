/**
 * Shift-change-request repository — data access for `shift_change_requests`.
 * Talks to D1 through Drizzle with no RLS; membership/authorization lives
 * in the service layer. The two former RPCs (`open_shift_change_request`,
 * `accept_shift_change_request`) are ported here as read-then-guarded-batch
 * (MIGRATION-NOTES §5.7/5.8): D1 has no row locks, so every write repeats its
 * precondition in its own WHERE and the batch is all-or-nothing.
 *
 * @module domains/shift/repositories/shiftChangeRequestRepository
 */
import type {
  Shift,
  ShiftChangeRequest,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_CHANGE_REQUEST_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { db } from '../../../db/client';
import { shiftLocalDate } from '../../../db/localDate';
import {
  shiftChangeRequests,
  shiftEvents,
  shifts,
  timeEntries,
} from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { chunk, nonEmpty } from '../../schedule/repositories/chunk';
import {
  ChangeRequestNotPendingError,
  ShiftImmutableError,
  ShiftNotFoundError,
  ShiftOverlapsError,
} from '../errors/shiftErrors';
import {
  insertIf,
  isCarerWindowOverlap,
  isoInstant,
} from '../utils/carerWindowOverlap';

/**
 * One day-thread event handed to an RPC to insert inside its own transaction.
 *
 * Deliberately carries NO `local_date`: `acceptAndApply` stamps the shift's
 * POST-update local date, so a time change that crosses local midnight lands
 * its events on the new day.
 */
export interface ShiftEventRpcInsert {
  household_id: string;
  shift_id: string;
  actor_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface AcceptShiftChangeRequestRpcArgs {
  p_change_request_id: string;
  p_responded_by: string;
  p_response_message: string | null;
  p_set_cancel: boolean;
  p_cancelled_at: string | null;
  p_cancelled_by: string | null;
  p_cancellation_paid: boolean;
  p_cancellation_message: string | null;
  p_set_times: boolean;
  p_starts_at: string | null;
  p_ends_at: string | null;
  p_origin: string | null;
  p_is_short_notice: boolean;
  p_events: ShiftEventRpcInsert[];
}

export interface OpenShiftChangeRequestRpcArgs {
  p_shift_id: string;
  p_requested_by: string;
  p_kind: ShiftChangeRequest['kind'];
  p_proposed_starts_at: string | null;
  p_proposed_ends_at: string | null;
  p_message: string | null;
}

type RpcOutcomePayload = {
  outcome: string;
  current_status?: string;
  shift_id?: string;
  shift_status?: string;
  blocked_by?: string;
  change_request?: ShiftChangeRequest;
  shift?: Shift;
  superseded?: ShiftChangeRequest[];
};

const PENDING = SHIFT_CHANGE_REQUEST_STATUSES.PENDING;
const IMMUTABLE_SHIFT_STATUSES: readonly string[] = ['completed', 'cancelled'];
/** Read-then-guarded-batch attempts before a racing write gives up. */
const CAS_ATTEMPTS = 3;

export class ShiftChangeRequestRepository extends BaseRepository<
  ShiftChangeRequest,
  typeof shiftChangeRequests
> {
  constructor() {
    super(shiftChangeRequests);
  }

  private fail(
    message: string,
    err: unknown,
    metadata: Record<string, unknown>
  ): DatabaseError {
    return new DatabaseError(message, 'DATABASE_ERROR', {
      details: err instanceof Error ? err.message : String(err),
      ...metadata,
    });
  }

  /** All change requests for one shift, newest first. */
  async listByShift(shiftId: string): Promise<ShiftChangeRequest[]> {
    try {
      return (await db
        .select()
        .from(shiftChangeRequests)
        .where(eq(shiftChangeRequests.shift_id, shiftId))
        .orderBy(desc(shiftChangeRequests.created_at))) as ShiftChangeRequest[];
    } catch (err) {
      throw this.fail('Failed to list shift change requests', err, { shiftId });
    }
  }

  /** Pending change requests whose `shift_id` is in `shiftIds`, newest first. */
  async listPendingByShiftIds(
    shiftIds: string[]
  ): Promise<ShiftChangeRequest[]> {
    if (shiftIds.length === 0) {
      return [];
    }
    try {
      const pages = await Promise.all(
        chunk(shiftIds).map(ids =>
          db
            .select()
            .from(shiftChangeRequests)
            .where(
              and(
                inArray(shiftChangeRequests.shift_id, ids),
                eq(shiftChangeRequests.status, PENDING)
              )
            )
        )
      );
      return (pages.flat() as ShiftChangeRequest[]).sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      );
    } catch (err) {
      throw this.fail('Failed to list pending shift change requests', err, {
        shiftCount: shiftIds.length,
      });
    }
  }

  /**
   * Why a shift cannot take a change-request write right now, or null when
   * it can — the shared preflight of both RPC ports (steps 1–3).
   */
  private async blockedOutcome(
    shiftId: string
  ): Promise<{ live: Shift } | RpcOutcomePayload> {
    const [shift] = (await db
      .select()
      .from(shifts)
      .where(eq(shifts.id, shiftId))) as Shift[];
    if (!shift) return { outcome: 'shift_not_found', shift_id: shiftId };
    const immutable = (blocked_by: string): RpcOutcomePayload => ({
      outcome: 'shift_immutable',
      shift_id: shift.id,
      shift_status: shift.status,
      blocked_by,
    });
    if (IMMUTABLE_SHIFT_STATUSES.includes(shift.status)) {
      return immutable('status');
    }
    // ANY time entry, voided included — the RPCs never filtered on status.
    const [entry] = await db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(eq(timeEntries.shift_id, shift.id))
      .limit(1);
    if (entry) return immutable('has_time_entries');
    return { live: shift };
  }

  private async pendingSiblings(
    shiftId: string,
    excludeId?: string
  ): Promise<ShiftChangeRequest[]> {
    return (await db
      .select()
      .from(shiftChangeRequests)
      .where(
        and(
          eq(shiftChangeRequests.shift_id, shiftId),
          eq(shiftChangeRequests.status, PENDING),
          excludeId ? ne(shiftChangeRequests.id, excludeId) : undefined
        )
      )) as ShiftChangeRequest[];
  }

  /**
   * Port of `accept_shift_change_request` (MIGRATION-NOTES §5.8): accept a
   * pending request, supersede its siblings, apply the shift mutation and
   * write the day-thread events — as ONE all-or-nothing D1 batch.
   *
   * FOR UPDATE replacement. After the reads, statement 1 (the accept CAS) is
   * guarded by everything the reads established: request still pending,
   * shift still live at the `sequence` we read, no time entries, and the
   * pending-sibling set unchanged. Every later statement is gated on
   * statement 1 having landed (the accepted row carrying OUR `responded_at`
   * token). A lost race makes the whole batch a no-op; we then re-read, and
   * either return the outcome the RPC would have, or retry. An overlap from
   * the shift update aborts the batch, accept included — as the Postgres
   * transaction did.
   */
  async acceptAndApply(args: AcceptShiftChangeRequestRpcArgs): Promise<{
    changeRequest: ShiftChangeRequest;
    shift: Shift;
    superseded: ShiftChangeRequest[];
  }> {
    const id = args.p_change_request_id;
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const payload = await this.tryAccept(args).catch(err => {
        // S4a: accepting a time_change can move the shift onto a window this
        // carer already holds in this household. That is the accepting
        // party's conflict to resolve, not a 500.
        if (isCarerWindowOverlap(err)) {
          throw new ShiftOverlapsError({ changeRequestId: id });
        }
        if (err instanceof DatabaseError) throw err;
        throw this.fail('Failed to accept shift change request', err, {
          changeRequestId: id,
        });
      });
      if (payload) return this.handleAcceptOutcome(id, payload);
    }
    throw this.fail(
      'Failed to accept shift change request',
      'lost the race repeatedly',
      { changeRequestId: id }
    );
  }

  /** One read-then-batch attempt. `null` = lost a race that warrants a retry. */
  private async tryAccept(
    args: AcceptShiftChangeRequestRpcArgs
  ): Promise<RpcOutcomePayload | null> {
    const id = args.p_change_request_id;
    const [request] = (await db
      .select()
      .from(shiftChangeRequests)
      .where(eq(shiftChangeRequests.id, id))) as ShiftChangeRequest[];
    if (!request) return { outcome: 'not_pending', current_status: 'missing' };

    const blocked = await this.blockedOutcome(request.shift_id);
    if (!('live' in blocked)) return blocked;
    const shift = blocked.live;
    if (request.status !== PENDING) {
      return { outcome: 'not_pending', current_status: request.status };
    }

    const siblings = await this.pendingSiblings(shift.id, id);
    const siblingIds = siblings.map(s => s.id);
    const now = new Date().toISOString();

    const accepted = sql`EXISTS (SELECT 1 FROM shift_change_requests WHERE id = ${id} AND status = 'accepted' AND responded_by = ${args.p_responded_by} AND responded_at = ${now})`;

    // Shift post-state, computed here because the old trigger is gone.
    const startsAt =
      args.p_set_times && args.p_starts_at
        ? isoInstant(args.p_starts_at)
        : null;
    const endsAt =
      args.p_set_times && args.p_ends_at ? isoInstant(args.p_ends_at) : null;
    const localDate = startsAt
      ? shiftLocalDate(startsAt, shift.timezone)
      : shift.local_date;

    const acceptStmt = db
      .update(shiftChangeRequests)
      .set({
        status: 'accepted',
        responded_by: args.p_responded_by,
        responded_at: now,
        response_message: args.p_response_message,
        updated_at: now,
      })
      .where(
        and(
          eq(shiftChangeRequests.id, id),
          eq(shiftChangeRequests.status, PENDING),
          sql`EXISTS (SELECT 1 FROM shifts WHERE id = ${shift.id} AND sequence = ${shift.sequence} AND status NOT IN ('completed', 'cancelled'))`,
          sql`NOT EXISTS (SELECT 1 FROM time_entries WHERE shift_id = ${shift.id})`,
          // The pending-sibling set is exactly what we read.
          sql`(SELECT count(*) FROM shift_change_requests WHERE shift_id = ${shift.id} AND status = 'pending' AND id <> ${id}) = ${siblingIds.length}`,
          siblingIds.length > 0
            ? sql`NOT EXISTS (SELECT 1 FROM shift_change_requests WHERE shift_id = ${shift.id} AND status = 'pending' AND id <> ${id} AND id NOT IN (${sql.join(
                siblingIds.map(s => sql`${s}`),
                sql`, `
              )}))`
            : undefined
        )
      )
      .returning();

    const supersedeStmt = db
      .update(shiftChangeRequests)
      .set({ status: 'superseded', updated_at: now })
      .where(
        and(
          eq(shiftChangeRequests.shift_id, shift.id),
          eq(shiftChangeRequests.status, PENDING),
          ne(shiftChangeRequests.id, id),
          accepted
        )
      )
      .returning();

    const shiftPatch: Partial<Shift> | null = args.p_set_cancel
      ? {
          status: 'cancelled',
          cancelled_at: args.p_cancelled_at
            ? isoInstant(args.p_cancelled_at)
            : null,
          cancelled_by: args.p_cancelled_by,
          cancellation_paid: args.p_cancellation_paid,
          cancellation_message: args.p_cancellation_message,
          is_short_notice: args.p_is_short_notice,
          origin: args.p_origin as Shift['origin'],
          updated_at: now,
        }
      : args.p_set_times && startsAt && endsAt
        ? {
            starts_at: startsAt,
            ends_at: endsAt,
            local_date: localDate,
            origin: args.p_origin as Shift['origin'],
            is_short_notice: args.p_is_short_notice,
            sequence: shift.sequence + 1,
            updated_at: now,
          }
        : null;

    const events = [
      ...args.p_events.map(e => ({
        household_id: e.household_id,
        shift_id: e.shift_id,
        actor_id: e.actor_id === '' ? null : e.actor_id,
        event_type: e.event_type,
        payload: e.payload ?? {},
      })),
      ...siblings.map(s => ({
        household_id: shift.household_id,
        shift_id: shift.id,
        actor_id: args.p_responded_by,
        event_type: 'change_request_superseded',
        payload: {
          change_request_id: s.id,
          kind: s.kind,
          superseded_by: id,
        },
      })),
    ].map(e =>
      insertIf(
        shiftEvents,
        {
          id: crypto.randomUUID(),
          ...e,
          local_date: localDate,
          payload: JSON.stringify(e.payload),
        },
        accepted
      )
    );

    const shiftStmt = shiftPatch
      ? db
          .update(shifts)
          .set(shiftPatch)
          .where(and(eq(shifts.id, shift.id), accepted))
          .returning()
      : null;

    const results = (await db.batch([
      acceptStmt,
      supersedeStmt,
      ...(shiftStmt ? [shiftStmt] : []),
      ...events,
    ])) as unknown[];
    const [acceptedRow] = results[0] as ShiftChangeRequest[];
    if (!acceptedRow) {
      // Lost a race. Re-read: a settled request or a now-blocked shift has a
      // definite answer; a moved sequence or a new sibling is worth a retry.
      const [current] = await db
        .select({ status: shiftChangeRequests.status })
        .from(shiftChangeRequests)
        .where(eq(shiftChangeRequests.id, id));
      if (!current) {
        return { outcome: 'not_pending', current_status: 'missing' };
      }
      const nowBlocked = await this.blockedOutcome(shift.id);
      if (!('live' in nowBlocked)) return nowBlocked;
      if (current.status !== PENDING) {
        return { outcome: 'not_pending', current_status: current.status };
      }
      return null;
    }
    const updatedShift = shiftStmt ? (results[2] as Shift[])[0] : shift;
    return {
      outcome: 'accepted',
      change_request: acceptedRow,
      shift: updatedShift,
      superseded: results[1] as ShiftChangeRequest[],
    };
  }

  /**
   * Port of `open_shift_change_request` (MIGRATION-NOTES §5.7): supersede
   * the shift's pending requests and insert a new pending one, with its
   * `change_request_created` / `change_request_superseded` events, as ONE
   * all-or-nothing D1 batch.
   *
   * Guards: the supersede is gated on the shift still being live, having no
   * time entries, and its pending set being exactly what we read; the insert
   * on there being no pending request left (so only our supersede can have
   * cleared the way); the events on the new row existing. 0 rows → re-read
   * for a definite outcome, or retry.
   */
  async openWithSupersede(args: OpenShiftChangeRequestRpcArgs): Promise<{
    changeRequest: ShiftChangeRequest;
    superseded: ShiftChangeRequest[];
  }> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      let outcome: RpcOutcomePayload | null;
      try {
        outcome = await this.tryOpen(args);
      } catch (err) {
        throw this.fail('Failed to open shift change request', err, {
          shiftId: args.p_shift_id,
        });
      }
      if (!outcome) continue;
      if (outcome.outcome === 'opened' && outcome.change_request) {
        return {
          changeRequest: outcome.change_request,
          superseded: outcome.superseded ?? [],
        };
      }
      if (outcome.outcome === 'shift_not_found') {
        throw new ShiftNotFoundError(args.p_shift_id);
      }
      if (outcome.outcome === 'shift_immutable') {
        throw new ShiftImmutableError(
          outcome.shift_id ?? args.p_shift_id,
          outcome.shift_status ?? 'unknown',
          outcome.blocked_by ?? 'status'
        );
      }
      throw new DatabaseError(
        'Unexpected outcome from open_shift_change_request',
        'DATABASE_ERROR',
        { outcome: outcome.outcome, shiftId: args.p_shift_id }
      );
    }
    throw this.fail(
      'Failed to open shift change request',
      'lost the race repeatedly',
      { shiftId: args.p_shift_id }
    );
  }

  private async tryOpen(
    args: OpenShiftChangeRequestRpcArgs
  ): Promise<RpcOutcomePayload | null> {
    const blocked = await this.blockedOutcome(args.p_shift_id);
    if (!('live' in blocked)) return blocked;
    const shift = blocked.live;
    const siblings = await this.pendingSiblings(shift.id);
    const siblingIds = siblings.map(s => s.id);
    const newId = crypto.randomUUID();

    const shiftOpen = sql`EXISTS (SELECT 1 FROM shifts WHERE id = ${shift.id} AND status NOT IN ('completed', 'cancelled')) AND NOT EXISTS (SELECT 1 FROM time_entries WHERE shift_id = ${shift.id})`;
    const created = sql`EXISTS (SELECT 1 FROM shift_change_requests WHERE id = ${newId})`;

    const supersede =
      siblingIds.length > 0
        ? db
            .update(shiftChangeRequests)
            .set({ status: 'superseded', updated_at: new Date().toISOString() })
            .where(
              and(
                inArray(shiftChangeRequests.id, siblingIds),
                eq(shiftChangeRequests.status, PENDING),
                shiftOpen,
                sql`(SELECT count(*) FROM shift_change_requests WHERE shift_id = ${shift.id} AND status = 'pending') = ${siblingIds.length}`
              )
            )
            .returning()
        : null;

    const insert = insertIf(
      shiftChangeRequests,
      {
        id: newId,
        shift_id: shift.id,
        requested_by: args.p_requested_by,
        kind: args.p_kind,
        proposed_starts_at: args.p_proposed_starts_at
          ? isoInstant(args.p_proposed_starts_at)
          : null,
        proposed_ends_at: args.p_proposed_ends_at
          ? isoInstant(args.p_proposed_ends_at)
          : null,
        message: args.p_message,
        status: PENDING,
      },
      sql`NOT EXISTS (SELECT 1 FROM shift_change_requests WHERE shift_id = ${shift.id} AND status = 'pending') AND ${shiftOpen}`
    );

    const event = (eventType: string, payload: Record<string, unknown>) =>
      insertIf(
        shiftEvents,
        {
          id: crypto.randomUUID(),
          household_id: shift.household_id,
          shift_id: shift.id,
          local_date: shift.local_date,
          actor_id: args.p_requested_by,
          event_type: eventType,
          payload: JSON.stringify(payload),
        },
        created
      );

    const statements: BatchItem<'sqlite'>[] = [
      ...(supersede ? [supersede] : []),
      insert,
      event('change_request_created', {
        change_request_id: newId,
        kind: args.p_kind,
        message: args.p_message,
      }),
      ...siblings.map(s =>
        event('change_request_superseded', {
          change_request_id: s.id,
          kind: s.kind,
          superseded_by: newId,
        })
      ),
    ];
    const results = (await db.batch(nonEmpty(statements))) as unknown[];

    const [opened] = (await db
      .select()
      .from(shiftChangeRequests)
      .where(eq(shiftChangeRequests.id, newId))) as ShiftChangeRequest[];
    if (!opened) {
      // A sibling appeared, or the shift settled, between read and batch.
      const nowBlocked = await this.blockedOutcome(shift.id);
      return 'live' in nowBlocked ? null : nowBlocked;
    }
    return {
      outcome: 'opened',
      change_request: opened,
      superseded: supersede ? (results[0] as ShiftChangeRequest[]) : [],
    };
  }

  /** `UPDATE … WHERE id = ? AND status = 'pending' RETURNING *` — throws when the CAS misses. */
  private async casPending(
    changeRequestId: string,
    patch: Partial<ShiftChangeRequest>,
    message: string
  ): Promise<ShiftChangeRequest> {
    let rows: ShiftChangeRequest[];
    try {
      rows = (await db
        .update(shiftChangeRequests)
        .set(patch)
        .where(
          and(
            eq(shiftChangeRequests.id, changeRequestId),
            eq(shiftChangeRequests.status, PENDING)
          )
        )
        .returning()) as ShiftChangeRequest[];
    } catch (err) {
      throw this.fail(message, err, { changeRequestId });
    }
    const [row] = rows;
    if (!row) {
      throw new ChangeRequestNotPendingError(changeRequestId, 'unknown');
    }
    return row;
  }

  /**
   * Accept or decline a still-`pending` request (compare-and-set). Writes the
   * responder's text to `response_message` — never overwrites the requester's
   * `message` (migration 023). Used for decline-only; accept goes through
   * `acceptAndApply`.
   */
  async respond(
    changeRequestId: string,
    status: 'accepted' | 'declined',
    respondedBy: string,
    message?: string | null
  ): Promise<ShiftChangeRequest> {
    return this.casPending(
      changeRequestId,
      {
        status,
        responded_by: respondedBy,
        responded_at: new Date().toISOString(),
        ...(message !== undefined &&
          message !== null && { response_message: message }),
      },
      'Failed to respond to shift change request'
    );
  }

  /** pending -> withdrawn (compare-and-set). */
  async withdraw(changeRequestId: string): Promise<ShiftChangeRequest> {
    return this.casPending(
      changeRequestId,
      { status: SHIFT_CHANGE_REQUEST_STATUSES.WITHDRAWN },
      'Failed to withdraw shift change request'
    );
  }

  /**
   * Bulk `pending -> expired` for every request opened before `cutoffIso`
   * (F-B5-5, migration 064). Returns the rows this call actually flipped.
   *
   * Compare-and-set on `pending` like `withdraw`, and for the same reason: a
   * settled row must never be reopened as `expired` by a sweep that reads it
   * a moment after someone answered. Unlike `withdraw`, matching NOTHING is
   * the normal outcome, so this returns an empty array where the single-row
   * paths throw.
   *
   * No `responded_by` / `responded_at`: nobody responded, that is the whole
   * point of the status.
   */
  async expirePendingOlderThan(
    cutoffIso: string
  ): Promise<ShiftChangeRequest[]> {
    try {
      return (await db
        .update(shiftChangeRequests)
        .set({ status: SHIFT_CHANGE_REQUEST_STATUSES.EXPIRED })
        .where(
          and(
            eq(shiftChangeRequests.status, PENDING),
            lt(shiftChangeRequests.created_at, isoInstant(cutoffIso))
          )
        )
        .returning()) as ShiftChangeRequest[];
    } catch (err) {
      throw this.fail('Failed to expire stale shift change requests', err, {
        cutoffIso,
      });
    }
  }

  /**
   * A5: expire pending requests whose SHIFT has already started.
   *
   * The `created_at`-keyed 7-day sweep above cannot see this case at all — a
   * request opened yesterday about tomorrow's 08:00 shift is six days from its
   * cutoff, so it sits `pending` long after the morning it was about.
   *
   * One statement on D1 (PostgREST needed a read then an update): the
   * subquery reaches the parent table, and `status = 'pending'` in the same
   * WHERE leaves a request answered concurrently alone.
   */
  async expirePendingForStartedShifts(
    nowIso: string
  ): Promise<ShiftChangeRequest[]> {
    try {
      return (await db
        .update(shiftChangeRequests)
        .set({ status: SHIFT_CHANGE_REQUEST_STATUSES.EXPIRED })
        .where(
          and(
            eq(shiftChangeRequests.status, PENDING),
            sql`EXISTS (SELECT 1 FROM shifts s WHERE s.id = ${shiftChangeRequests.shift_id} AND s.starts_at <= ${isoInstant(nowIso)})`
          )
        )
        .returning()) as ShiftChangeRequest[];
    } catch (err) {
      throw this.fail(
        'Failed to expire change requests for started shifts',
        err,
        { nowIso }
      );
    }
  }

  private handleAcceptOutcome(
    changeRequestId: string,
    payload: RpcOutcomePayload
  ): {
    changeRequest: ShiftChangeRequest;
    shift: Shift;
    superseded: ShiftChangeRequest[];
  } {
    switch (payload.outcome) {
      case 'accepted':
        if (!payload.change_request || !payload.shift) {
          throw new DatabaseError(
            'accept_shift_change_request returned accepted without rows',
            'DATABASE_ERROR',
            { changeRequestId }
          );
        }
        return {
          changeRequest: payload.change_request,
          shift: payload.shift,
          superseded: payload.superseded ?? [],
        };
      case 'not_pending':
        throw new ChangeRequestNotPendingError(
          changeRequestId,
          payload.current_status ?? 'unknown'
        );
      case 'shift_immutable':
        throw new ShiftImmutableError(
          payload.shift_id ?? changeRequestId,
          payload.shift_status ?? 'unknown',
          payload.blocked_by ?? 'status'
        );
      case 'shift_not_found':
        throw new ShiftNotFoundError(payload.shift_id ?? changeRequestId);
      default:
        throw new DatabaseError(
          'Unexpected outcome from accept_shift_change_request',
          'DATABASE_ERROR',
          { outcome: payload.outcome, changeRequestId }
        );
    }
  }
}
