/**
 * Shift repository — data access for the `shifts` table, plus its nested
 * `shift_children`. Extends BaseRepository for standard CRUD (only `update`
 * and `findById` are used — this domain reads freely but writes only via the
 * parent-edit PATCH, see `shiftCommandService`) and adds the two read
 * queries the calendar feed needs. Talks to D1 through Drizzle with no RLS,
 * so ownership/authorization is enforced in the SERVICE layer, never here.
 *
 * NOTE: the `schedule` domain's `scheduleShiftRepository.ts` is the ONE
 * place that CREATES/DELETES `shifts` rows (materialisation) — this
 * repository never does either, avoiding any overlap with that write path.
 *
 * IMMUTABILITY GUARD: `update` refuses to touch a shift that is already
 * `completed`/`cancelled`, or that anyone has clocked into (`time_entries`).
 * This mirrors the policy `scheduleMaterialisationService` already enforces
 * on the re-materialisation write path (see its NEVER_TOUCH_STATUSES /
 * `hasTimeEntries` branches) and closes the same hole on the shift domain's
 * write path: accepting a change request must not rewrite past, paid-for
 * reality either. It lives HERE rather than in a service because both
 * change-request mutations (`applyAcceptedChange`'s cancel and time-change
 * branches) funnel through this one method — one chokepoint, no way around
 * it. Same precedent as `timeEntryRepository`, which also raises a domain
 * conflict error from the repository layer.
 *
 * @module domains/shift/repositories/shiftRepository
 */
import type {
  Shift,
  ShiftChild,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import { chunk } from '../../../db/chunk';
import { db } from '../../../db/client';
import { insertIf } from '../../../db/insertIf';
import { shiftLocalDate } from '../../../db/localDate';
import { shiftChildren, shiftEvents, shifts } from '../../../db/schema';
import { DatabaseError, ValidationError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
// S4b's clash-scan row shape lives with the sweep-line that consumes it, not
// here — this repository only produces rows shaped for it.
import type { ClashScanShift } from '../../schedule/utils/crossHouseholdClashes';
// Import the repository file DIRECTLY — never the timesheet domain barrel,
// whose services import this one back. Same narrow, read-only cross-domain
// dependency `scheduleMaterialisationService` already takes on
// `hasTimeEntries`.
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import {
  ExtraShiftAlreadyExistsError,
  ShiftImmutableError,
  ShiftNotFoundError,
  ShiftOverlapsError,
} from '../errors/shiftErrors';
import {
  EXTRA_WINDOW_UNIQUE_INDEX,
  isCarerWindowOverlap,
  isoInstant,
  isUniqueViolationOn,
} from '../utils/carerWindowOverlap';

/** A shift joined with its `shift_children` rows — each shift carries its `shift_children` array inline (`*, shift_children(*)` shape). */
export interface ShiftWithChildren extends Shift {
  shift_children: ShiftChild[];
}

/** The narrow contract behind "has anyone clocked into this shift?" — see `TimeEntryRepository.hasTimeEntries`. */
export interface ShiftTimeEntryExistenceRepository {
  hasTimeEntries(shiftId: string): Promise<boolean>;
}

/** Finished business: a shift in one of these statuses is never mutated again. */
const IMMUTABLE_STATUSES: ReadonlySet<Shift['status']> = new Set([
  'completed',
  'cancelled',
]);

/** Read-then-guarded-batch attempts before a parent edit gives up on a race. */
const PARENT_EDIT_ATTEMPTS = 3;

const details = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export class ShiftRepository extends BaseRepository<Shift, typeof shifts> {
  constructor(
    private readonly timeEntryRepo: ShiftTimeEntryExistenceRepository = new TimeEntryRepository()
  ) {
    super(shifts);
  }

  /**
   * Guarded update — see the IMMUTABILITY GUARD note in the module header.
   * Throws `ShiftImmutableError` (409) rather than silently no-op'ing, so an
   * accepted change request against a completed/cancelled/clocked-into shift
   * surfaces to the caller instead of quietly rewriting settled history.
   *
   * `local_date` is re-derived whenever `starts_at` or `timezone` is in the
   * patch (Postgres's `sync_shifts_local_date` trigger, MIGRATION-NOTES §4).
   */
  override async update(id: string, data: Partial<Shift>): Promise<Shift> {
    await this.assertMutable(id);
    if (data.starts_at === undefined && data.timezone === undefined) {
      return super.update(id, data);
    }
    const current = await this.findById(id);
    if (!current) throw new ShiftNotFoundError(id);
    const startsAt = isoInstant(data.starts_at ?? current.starts_at);
    const patch: Partial<Shift> = {
      ...data,
      ...(data.starts_at !== undefined && { starts_at: startsAt }),
      ...(data.ends_at !== undefined && { ends_at: isoInstant(data.ends_at) }),
      local_date: shiftLocalDate(startsAt, data.timezone ?? current.timezone),
    };
    return super.update(id, patch);
  }

  /** Throws unless the shift exists and is still open to mutation. */
  async assertMutable(shiftId: string): Promise<void> {
    const shift = await this.findById(shiftId);
    if (!shift) {
      throw new ShiftNotFoundError(shiftId);
    }
    if (IMMUTABLE_STATUSES.has(shift.status)) {
      throw new ShiftImmutableError(shiftId, shift.status);
    }
    if (await this.timeEntryRepo.hasTimeEntries(shiftId)) {
      throw new ShiftImmutableError(shiftId, shift.status, 'has_time_entries');
    }
  }

  /**
   * CAS on `status = 'pending'` — the shared body of accept / decline /
   * withdraw. `assertMutable` is a soft preflight; the WHERE clause is the
   * guard, so a concurrent cancel/demote/accept cannot be overwritten.
   */
  private async casFromPending(
    shiftId: string,
    patch: Partial<Shift>,
    failMessage: string,
    notPendingMessage: string
  ): Promise<Shift> {
    await this.assertMutable(shiftId);
    let rows: Shift[];
    try {
      rows = (await db
        .update(shifts)
        .set(patch)
        .where(and(eq(shifts.id, shiftId), eq(shifts.status, 'pending')))
        .returning()) as Shift[];
    } catch (err) {
      throw new DatabaseError(failMessage, 'DATABASE_ERROR', {
        details: details(err),
        shiftId,
      });
    }
    const [row] = rows;
    if (!row) {
      // Lost the pending race (concurrent accept/cancel/edit) after preflight.
      throw new ValidationError(notPendingMessage, 'SHIFT_NOT_PENDING', 400, {
        shiftId,
      });
    }
    return row;
  }

  /**
   * CAS pending → confirmed for carer accept. Change-request accept
   * serialises through `ShiftChangeRequestRepository.acceptAndApply` instead.
   */
  async confirmPending(shiftId: string): Promise<Shift> {
    return this.casFromPending(
      shiftId,
      { status: 'confirmed' },
      'Failed to confirm pending shift',
      'Only a pending shift can be accepted'
    );
  }

  /**
   * CAS pending → declined for carer decline — the symmetric write to
   * `confirmPending`. `declined` is terminal, which makes losing that race
   * unrecoverable, so the CAS is doing more work here than on the accept leg.
   */
  async declinePending(shiftId: string): Promise<Shift> {
    return this.casFromPending(
      shiftId,
      { status: 'declined' },
      'Failed to decline pending shift',
      'Only a pending shift can be declined'
    );
  }

  /**
   * CAS pending → cancelled for a parent withdrawing an unanswered cover ask.
   * `cancelled_by` is the withdrawing parent — the discriminator from EXPIRY,
   * which lands on `cancelled` with `cancelled_by` null (migration 088 /
   * `coverAskExpiryJob`). Same status, different actor: expired means nobody
   * acted; withdrawn means the family retracted the question.
   */
  async withdrawCoverAsk(
    shiftId: string,
    cancelledBy: string,
    cancelledAt: string
  ): Promise<Shift> {
    return this.casFromPending(
      shiftId,
      {
        status: 'cancelled',
        cancelled_at: isoInstant(cancelledAt),
        cancelled_by: cancelledBy,
        cancellation_paid: false,
      },
      'Failed to withdraw cover ask',
      'Only a pending shift can be withdrawn'
    );
  }

  /** `SELECT * FROM shifts WHERE … ORDER BY starts_at`, each row carrying its `shift_children`. */
  private async selectWithChildren(
    where: SQL | undefined,
    message: string,
    metadata: Record<string, unknown>
  ): Promise<ShiftWithChildren[]> {
    try {
      const rows = (await db
        .select()
        .from(shifts)
        .where(where)
        .orderBy(asc(shifts.starts_at))) as Shift[];
      return await this.attachChildren(rows);
    } catch (err) {
      throw new DatabaseError(message, 'DATABASE_ERROR', {
        details: details(err),
        ...metadata,
      });
    }
  }

  /** The nested `shift_children(*)` embed as a second query (chunked under D1's bound-parameter cap). */
  private async attachChildren(rows: Shift[]): Promise<ShiftWithChildren[]> {
    if (rows.length === 0) return [];
    const pages = await Promise.all(
      chunk(rows.map(r => r.id)).map(ids =>
        db
          .select()
          .from(shiftChildren)
          .where(inArray(shiftChildren.shift_id, ids))
      )
    );
    const byShift = new Map<string, ShiftChild[]>();
    for (const child of pages.flat() as ShiftChild[]) {
      const list = byShift.get(child.shift_id) ?? [];
      list.push(child);
      byShift.set(child.shift_id, list);
    }
    return rows.map(r => ({ ...r, shift_children: byShift.get(r.id) ?? [] }));
  }

  /**
   * Shifts overlapping `[from, to)`, each carrying its `shift_children` —
   * the primary calendar feed, sized to avoid an N+1 per-shift children
   * fetch. Overlap semantics match `busyBlockRepository.listForCarer`: a
   * shift STARTS before `to` AND ENDS after `from` (both strict, so a shift
   * that only touches the boundary is excluded).
   */
  async findByHouseholdAndRange(
    householdId: string,
    from: string,
    to: string
  ): Promise<ShiftWithChildren[]> {
    return this.selectWithChildren(
      and(
        eq(shifts.household_id, householdId),
        lt(shifts.starts_at, isoInstant(to)),
        gt(shifts.ends_at, isoInstant(from))
      ),
      'Failed to list shifts for household range',
      { householdId, from, to }
    );
  }

  /**
   * S4b — every LIVE, carer-assigned shift overlapping `[from, to)`, across
   * EVERY household, narrowed to exactly the columns
   * `findCrossHouseholdClashes` needs. This is the one query that is
   * deliberately NOT household-scoped: the whole point of the sweep is
   * comparing one carer's shifts across different families. `carer_id is not
   * null` and the `status in (pending, confirmed)` live set mirror the old
   * `v_busy_blocks` shifts arm. Ordered by `carer_id` so the sweep-line can
   * group without a second pass.
   */
  async listLiveForClashScan(
    from: string,
    to: string
  ): Promise<ClashScanShift[]> {
    try {
      return (await db
        .select({
          id: shifts.id,
          household_id: shifts.household_id,
          carer_id: shifts.carer_id,
          starts_at: shifts.starts_at,
          ends_at: shifts.ends_at,
          local_date: shifts.local_date,
          ical_uid: shifts.ical_uid,
        })
        .from(shifts)
        .where(
          and(
            isNotNull(shifts.carer_id),
            inArray(shifts.status, ['pending', 'confirmed']),
            lt(shifts.starts_at, isoInstant(to)),
            gt(shifts.ends_at, isoInstant(from))
          )
        )
        .orderBy(asc(shifts.carer_id))) as ClashScanShift[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list live shifts for cross-household clash scan',
        'DATABASE_ERROR',
        { details: details(err), from, to }
      );
    }
  }

  /**
   * Every shift whose household-LOCAL calendar date is `localDate`, each
   * carrying its `shift_children`. Keyed on the stored `local_date` column
   * (set on every write via `shiftLocalDate`) rather than a UTC range,
   * because coverage-gap detection reasons in the household's own wall clock
   * — see `coverageGapService`.
   */
  async findByHouseholdAndLocalDate(
    householdId: string,
    localDate: string
  ): Promise<ShiftWithChildren[]> {
    return this.selectWithChildren(
      and(
        eq(shifts.household_id, householdId),
        eq(shifts.local_date, localDate)
      ),
      'Failed to list shifts for household local date',
      { householdId, localDate }
    );
  }

  /** Batch fetch by primary key — empty input returns without a round trip. */
  async findByIds(ids: string[]): Promise<Shift[]> {
    if (ids.length === 0) {
      return [];
    }
    try {
      const pages = await Promise.all(
        chunk(ids).map(page =>
          db.select().from(shifts).where(inArray(shifts.id, page))
        )
      );
      return pages.flat() as Shift[];
    } catch (err) {
      throw new DatabaseError('Failed to list shifts by id', 'DATABASE_ERROR', {
        details: details(err),
        count: ids.length,
      });
    }
  }

  /**
   * Cancelled shifts flagged `cancellation_paid` and starting on/after
   * `since` — the reconcile job's candidate set (`cancellationPayReconcileJob`).
   * The `status` filter is belt-and-braces on a money path: this query feeds
   * a write that creates a PAYABLE, and a live shift must never reach it.
   *
   * Unassigned shifts are excluded: `recordCancellationPaidEntry` returns
   * `[]` early for a null carer — nobody is owed anything. Fetching them
   * would make the sweep report a repair it never performed, on every run.
   */
  async listCancellationPaidSince(since: string): Promise<Shift[]> {
    try {
      return (await db
        .select()
        .from(shifts)
        .where(
          and(
            eq(shifts.cancellation_paid, true),
            eq(shifts.status, 'cancelled'),
            isNotNull(shifts.carer_id),
            sql`${shifts.starts_at} >= ${isoInstant(since)}`
          )
        )
        .orderBy(asc(shifts.starts_at))) as Shift[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list cancellation-paid shifts',
        'DATABASE_ERROR',
        { details: details(err), since }
      );
    }
  }

  /** One shift with its `shift_children`, or null. */
  async findByIdWithChildren(
    shiftId: string
  ): Promise<ShiftWithChildren | null> {
    const [row] = await this.selectWithChildren(
      eq(shifts.id, shiftId),
      'Failed to find shift with children',
      { shiftId }
    );
    return row ?? null;
  }

  /**
   * Create one shift row (extra-shift proposals, change-request outcomes).
   *
   * Inserts directly rather than via `BaseRepository.create` so the guards
   * translate into domain errors:
   * - 104's carer overlap → `ShiftOverlapsError`;
   * - 059's `shifts_extra_window_unique` → `ExtraShiftAlreadyExistsError`,
   *   so `insertExtraShift` can adopt the winner instead of 500ing the parent
   *   who double-tapped.
   *
   * D1 ORDERING TRAP: the overlap trigger runs BEFORE the unique index, so an
   * exact duplicate of a carer-assigned extra shift reports `overlap`, not
   * `unique` (Postgres checked 059 first). On an overlap for an extra shift we
   * therefore look for the identical live extra window and, if it exists,
   * answer with the adopt signal Postgres would have given.
   */
  async createShift(data: {
    household_id: string;
    carer_id: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string;
    kind: Shift['kind'];
    status: Shift['status'];
    origin: Shift['origin'];
    note?: string | null;
    reason?: string | null;
    created_by?: string | null;
    is_short_notice?: boolean;
    /**
     * D-47. Set ONLY at ask time, by the caller, and never recomputed — see
     * `domains/shift/utils/coverAskExpiry.ts`. Omitted (or null) on every
     * shift that is not an outstanding ask.
     */
    cover_ask_expires_at?: string | null;
  }): Promise<Shift> {
    const startsAt = isoInstant(data.starts_at);
    const endsAt = isoInstant(data.ends_at);
    const extraExists = new ExtraShiftAlreadyExistsError({
      householdId: data.household_id,
      startsAt: data.starts_at,
      endsAt: data.ends_at,
      carerId: data.carer_id,
    });
    try {
      const [created] = await db
        .insert(shifts)
        .values({
          household_id: data.household_id,
          carer_id: data.carer_id,
          starts_at: startsAt,
          ends_at: endsAt,
          timezone: data.timezone,
          local_date: shiftLocalDate(startsAt, data.timezone),
          kind: data.kind,
          status: data.status,
          source_pattern_id: null,
          origin: data.origin,
          is_short_notice: data.is_short_notice ?? false,
          note: data.note ?? null,
          reason: data.reason ?? null,
          created_by: data.created_by ?? null,
          cancellation_paid: false,
          cover_ask_expires_at:
            data.cover_ask_expires_at == null
              ? null
              : isoInstant(data.cover_ask_expires_at),
          sequence: 0,
        })
        .returning();
      return created as Shift;
    } catch (err) {
      if (isCarerWindowOverlap(err)) {
        if (
          data.kind === 'extra' &&
          (await this.findExtraShiftInWindow(
            data.household_id,
            data.carer_id,
            startsAt,
            endsAt
          ))
        ) {
          throw extraExists;
        }
        throw new ShiftOverlapsError({
          householdId: data.household_id,
          carerId: data.carer_id,
          startsAt: data.starts_at,
          endsAt: data.ends_at,
        });
      }
      if (isUniqueViolationOn(err, EXTRA_WINDOW_UNIQUE_INDEX)) {
        throw extraExists;
      }
      throw new DatabaseError('Failed to create shifts', 'DATABASE_ERROR', {
        operation: 'create',
        details: details(err),
      });
    }
  }

  /**
   * An existing live EXTRA shift with exactly this carer and window — the
   * natural key behind `insertExtraShift`'s retry guard. Cancelled shifts are
   * excluded on purpose: proposing a replacement for one that was called off
   * is a new shift, not a duplicate of it.
   *
   * Check-then-act, so two SIMULTANEOUS creates can both miss it. That is
   * fine: this is the cheap fast path, not the guard. The guard is 059's
   * `shifts_extra_window_unique` (or the overlap trigger, see `createShift`),
   * which refuses the loser's insert.
   */
  async findExtraShiftInWindow(
    householdId: string,
    carerId: string | null,
    startsAt: string,
    endsAt: string
  ): Promise<ShiftWithChildren | null> {
    const [row] = await this.selectWithChildren(
      and(
        eq(shifts.household_id, householdId),
        eq(shifts.kind, 'extra'),
        eq(shifts.starts_at, isoInstant(startsAt)),
        eq(shifts.ends_at, isoInstant(endsAt)),
        ne(shifts.status, 'cancelled'),
        carerId ? eq(shifts.carer_id, carerId) : isNull(shifts.carer_id)
      ),
      'Failed to look for an existing extra shift',
      { householdId, startsAt, endsAt }
    );
    return row ?? null;
  }

  /**
   * An existing live parent-cover shift with exactly this window — the
   * natural key behind `createParentCover`'s double-tap guard.
   */
  async findParentCoverInWindow(
    householdId: string,
    startsAt: string,
    endsAt: string
  ): Promise<Shift | null> {
    try {
      const [row] = await db
        .select()
        .from(shifts)
        .where(
          and(
            eq(shifts.household_id, householdId),
            eq(shifts.kind, 'parent_cover'),
            eq(shifts.starts_at, isoInstant(startsAt)),
            eq(shifts.ends_at, isoInstant(endsAt)),
            ne(shifts.status, 'cancelled')
          )
        )
        .limit(1);
      return (row as Shift | undefined) ?? null;
    } catch (err) {
      throw new DatabaseError(
        'Failed to look for an existing parent-cover shift',
        'DATABASE_ERROR',
        { details: details(err), householdId, startsAt, endsAt }
      );
    }
  }

  /** Attach whole-shift child coverage rows (null start/end). One statement per chunk, all-or-nothing. */
  async insertChildren(shiftId: string, childIds: string[]): Promise<void> {
    if (childIds.length === 0) {
      return;
    }
    const [first, ...rest] = chunk(childIds, 18).map(ids =>
      db.insert(shiftChildren).values(
        ids.map(child_id => ({
          shift_id: shiftId,
          child_id,
          starts_at: null,
          ends_at: null,
        }))
      )
    );
    try {
      if (first) await db.batch([first, ...rest]);
    } catch (err) {
      throw new DatabaseError(
        'Failed to insert shift children',
        'DATABASE_ERROR',
        { details: details(err), shiftId }
      );
    }
  }

  /**
   * Port of `apply_parent_shift_edit` (MIGRATION-NOTES §5.6). The caller
   * sends EDIT INTENT only; `sequence`, the demotion and the `shift_updated`
   * before/after snapshot are all derived here from the row as read.
   *
   * FOR UPDATE replacement: read, then one batch of
   *   1. the event insert, gated on `sequence = <read>` (the pre-state), then
   *   2. the shift UPDATE with the same `sequence = <read>` CAS.
   * A batch runs as one transaction, so if (1)'s gate held, (2)'s holds too,
   * and an overlap/unique error in (2) rolls (1) back. Event-first ordering
   * means the event's gate can't be satisfied by a concurrent writer's
   * sequence bump. 0 rows → someone edited in between: re-read and retry.
   *
   * Demotion (071 value diff): `confirmed` → `pending` iff a SET start or end
   * differs by value from the stored one; an identical resend or a note-only
   * edit keeps the status.
   */
  async applyParentEdit(args: {
    shiftId: string;
    actorId: string;
    startsAt: string | null;
    endsAt: string | null;
    note: string | null;
    setStartsAt: boolean;
    setEndsAt: boolean;
    setNote: boolean;
    origin: string;
  }): Promise<Shift> {
    for (let attempt = 0; attempt < PARENT_EDIT_ATTEMPTS; attempt++) {
      const before = await this.findById(args.shiftId);
      if (!before) {
        throw new DatabaseError(
          'Failed to apply parent shift edit',
          'DATABASE_ERROR',
          {
            details: `shift not found: ${args.shiftId}`,
            shiftId: args.shiftId,
          }
        );
      }
      const startsAt =
        args.setStartsAt && args.startsAt !== null
          ? isoInstant(args.startsAt)
          : before.starts_at;
      const endsAt =
        args.setEndsAt && args.endsAt !== null
          ? isoInstant(args.endsAt)
          : before.ends_at;
      const timeChanged =
        Date.parse(startsAt) !== Date.parse(before.starts_at) ||
        Date.parse(endsAt) !== Date.parse(before.ends_at);
      const after = {
        starts_at: startsAt,
        ends_at: endsAt,
        note: args.setNote ? args.note : before.note,
        sequence: before.sequence + 1,
        origin: args.origin as Shift['origin'],
        status:
          before.status === 'confirmed' && timeChanged
            ? ('pending' as const)
            : before.status,
      };
      const localDate = shiftLocalDate(startsAt, before.timezone);
      const preState = sql`EXISTS (SELECT 1 FROM shifts WHERE id = ${args.shiftId} AND sequence = ${before.sequence})`;
      const snapshot = (s: typeof after) => ({
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        note: s.note,
        sequence: s.sequence,
        origin: s.origin,
        status: s.status,
      });

      let updated: Shift[];
      try {
        [, updated] = (await db.batch([
          insertIf(
            shiftEvents,
            {
              id: crypto.randomUUID(),
              household_id: before.household_id,
              shift_id: before.id,
              local_date: localDate,
              actor_id: args.actorId,
              event_type: 'shift_updated',
              payload: JSON.stringify({
                before: snapshot(before),
                after: snapshot(after),
                actor_id: args.actorId,
              }),
            },
            preState
          ),
          db
            .update(shifts)
            .set({ ...after, local_date: localDate })
            .where(
              and(
                eq(shifts.id, args.shiftId),
                eq(shifts.sequence, before.sequence)
              )
            )
            .returning(),
        ])) as [unknown, Shift[]];
      } catch (err) {
        if (isCarerWindowOverlap(err)) {
          // 104 constrains UPDATEs too: a parent moving a shift on top of
          // another of this carer's live windows in the same household. On
          // D1 the trigger also pre-empts 059 for an exact extra duplicate.
          if (
            before.kind === 'extra' &&
            (await this.findExtraShiftInWindow(
              before.household_id,
              before.carer_id,
              startsAt,
              endsAt
            ))
          ) {
            throw new ExtraShiftAlreadyExistsError({ shiftId: args.shiftId });
          }
          throw new ShiftOverlapsError({ shiftId: args.shiftId });
        }
        // 059's index constrains UPDATEs too: re-timing an extra shift onto
        // another live one's exact window is the parent's conflict to
        // resolve, not a 500.
        if (isUniqueViolationOn(err, EXTRA_WINDOW_UNIQUE_INDEX)) {
          throw new ExtraShiftAlreadyExistsError({ shiftId: args.shiftId });
        }
        throw new DatabaseError(
          'Failed to apply parent shift edit',
          'DATABASE_ERROR',
          { details: details(err), shiftId: args.shiftId }
        );
      }
      const [row] = updated;
      if (row) return row;
    }
    throw new DatabaseError(
      'Failed to apply parent shift edit',
      'DATABASE_ERROR',
      {
        details: 'shift kept changing underneath the edit',
        shiftId: args.shiftId,
      }
    );
  }
}
