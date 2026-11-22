/**
 * Writes `shifts` rows FROM THE SCHEDULE DOMAIN — the one deliberate
 * exception to "a domain only writes its own tables". Materialising a
 * pattern into concrete shift rows is schedule-domain business logic (see
 * `services/scheduleMaterialisationService.ts`), and that logic must not
 * reach into `domains/shift/` (which owns shift response/negotiation flows —
 * accept, counter-offer, split, handover — a different bounded concern) to
 * avoid a domain-boundary cycle. This repository is scoped narrowly to what
 * materialisation needs: find-by-pattern, create, update, delete, plus the
 * satellite table it also has to keep in sync (`shift_children`). It never
 * queries `shift_change_requests` for anything beyond "does at least one
 * exist" (used to detect a manually-negotiated shift the re-materialiser
 * must not clobber), and it no longer writes `shift_events` at all: the
 * `pattern_conflict` row must be raised at most once per (pattern, shift,
 * date), so it goes through the shift domain's idempotent bulk-append pair
 * instead — see `services/scheduleMaterialisationService.ts`'s header.
 *
 * D1 notes: `local_date` is NOT NULL and no longer trigger-maintained, so every
 * insert, and every update touching `starts_at`/`timezone`, sets it here via
 * `shiftLocalDate` (MIGRATION-NOTES §4). Multi-row writes are split under D1's
 * 100-bound-parameter cap and sent as one `db.batch` (all-or-nothing, like the
 * single Postgres statement it replaces).
 *
 * @module domains/schedule/repositories/scheduleShiftRepository
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { shiftLocalDate } from '../../../db/localDate';
import { shiftChangeRequests, shiftChildren, shifts } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
// Cross-domain, and deliberately narrow: 104's overlap guard is a SHIFT fact,
// so the error it maps to lives with the shift domain rather than being
// re-declared here.
import { ShiftOverlapsError } from '../../shift/errors/shiftErrors';
import { RecurringShiftAlreadyExistsError } from '../errors/scheduleErrors';
import { chunk, nonEmpty } from './chunk';

export interface NewShiftData {
  household_id: string;
  carer_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  kind: Shift['kind'];
  status: Shift['status'];
  source_pattern_id: string | null;
  origin: Shift['origin'];
  note: string | null;
  ical_uid: string;
}

export interface NewShiftChildData {
  child_id: string;
  starts_at: string | null;
  ends_at: string | null;
}

/** 062's partial unique index. Matched by NAME — `shifts` has other unique keys (`ical_uid`, 059's extra-shift index). */
const RECURRING_WINDOW_UNIQUE_INDEX = 'shifts_recurring_window_unique';
/** 104's carer-overlap guard (a trigger on D1). */
const CARER_WINDOW_EXCLUSION = 'shifts_carer_window_excl';

const isRecurringWindowCollision = (err: unknown) => {
  const mapped = mapDbError(err);
  return (
    mapped?.kind === 'unique' &&
    mapped.constraint === RECURRING_WINDOW_UNIQUE_INDEX
  );
};

const isCarerWindowOverlap = (err: unknown) => {
  const mapped = mapDbError(err);
  return (
    mapped?.kind === 'overlap' && mapped.constraint === CARER_WINDOW_EXCLUSION
  );
};

const details = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const withLocalDate = (row: NewShiftData) => ({
  ...row,
  local_date: shiftLocalDate(row.starts_at, row.timezone),
});

/** 13 bound params per new shift row -> 6 rows per statement. */
const SHIFT_ROWS_PER_INSERT = 6;
/** 5 bound params per shift_children row. */
const CHILD_ROWS_PER_INSERT = 18;

export class ScheduleShiftRepository {
  /**
   * Every shift ever tied to this pattern, any status — the reconciliation
   * set, AND (since it already carries `local_date`) the occurrence lookup
   * the materialiser indexes in memory.
   */
  async findActiveByPattern(patternId: string): Promise<Shift[]> {
    try {
      return (await db
        .select()
        .from(shifts)
        .where(eq(shifts.source_pattern_id, patternId))) as Shift[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list shifts for pattern',
        'DATABASE_ERROR',
        { details: details(err), patternId }
      );
    }
  }

  /**
   * Which of `shiftIds` have EVER had a change request opened against them —
   * any status EXCEPT `expired`. Withdrawn/declined still count: a human
   * engaged with the shift. `expired` (migration 064, F-B5-5) means "nobody
   * answered for 7 days" and must NOT freeze the shift from
   * re-materialisation forever — see `scheduleMaterialisationService.ts`'s
   * module doc.
   */
  async shiftIdsWithChangeRequests(shiftIds: string[]): Promise<Set<string>> {
    if (shiftIds.length === 0) {
      return new Set();
    }
    try {
      const pages = await Promise.all(
        chunk(shiftIds).map(ids =>
          db
            .select({ shift_id: shiftChangeRequests.shift_id })
            .from(shiftChangeRequests)
            .where(
              and(
                inArray(shiftChangeRequests.shift_id, ids),
                ne(shiftChangeRequests.status, 'expired')
              )
            )
        )
      );
      return new Set(pages.flat().map(row => row.shift_id));
    } catch (err) {
      throw new DatabaseError(
        'Failed to check shift change requests',
        'DATABASE_ERROR',
        { details: details(err), count: shiftIds.length }
      );
    }
  }

  /**
   * A live `recurring` shift with exactly this carer and window, whatever
   * pattern produced it — the lookup behind the materialiser's
   * adopt-on-collision path. Cross-pattern by design.
   */
  async findRecurringInWindow(
    householdId: string,
    carerId: string | null,
    startsAt: string,
    endsAt: string
  ): Promise<Shift | null> {
    try {
      const rows = await db
        .select()
        .from(shifts)
        .where(
          and(
            eq(shifts.household_id, householdId),
            eq(shifts.kind, 'recurring'),
            eq(shifts.starts_at, startsAt),
            eq(shifts.ends_at, endsAt),
            ne(shifts.status, 'cancelled'),
            carerId ? eq(shifts.carer_id, carerId) : isNull(shifts.carer_id)
          )
        )
        .limit(1);
      return (rows[0] as Shift | undefined) ?? null;
    } catch (err) {
      throw new DatabaseError(
        'Failed to look for an existing recurring shift',
        'DATABASE_ERROR',
        { details: details(err), householdId, startsAt, endsAt }
      );
    }
  }

  /**
   * Translates 062's `shifts_recurring_window_unique` violation into
   * `RecurringShiftAlreadyExistsError` so the materialiser can adopt the
   * existing row instead of failing the whole run.
   */
  async create(data: NewShiftData): Promise<Shift> {
    try {
      const [created] = await db
        .insert(shifts)
        .values(withLocalDate(data))
        .returning();
      return created as Shift;
    } catch (err) {
      const window = {
        householdId: data.household_id,
        carerId: data.carer_id,
        startsAt: data.starts_at,
        endsAt: data.ends_at,
      };
      if (isRecurringWindowCollision(err)) {
        throw new RecurringShiftAlreadyExistsError(window);
      }
      // S4a. NOT an adopt signal — the existing row only OVERLAPS this
      // occurrence; the service records a `pattern_conflict` and carries on.
      // Except: on D1 the overlap guard is a BEFORE INSERT trigger, so it
      // fires before 062's index for an EXACT duplicate window too. Postgres
      // raised the unique violation there, so look for the twin and keep the
      // adopt path.
      if (isCarerWindowOverlap(err)) {
        const twin = await this.findRecurringInWindow(
          data.household_id,
          data.carer_id,
          data.starts_at,
          data.ends_at
        );
        throw twin
          ? new RecurringShiftAlreadyExistsError(window)
          : new ShiftOverlapsError(window);
      }
      throw new DatabaseError('Failed to create shift', 'DATABASE_ERROR', {
        details: details(err),
        ...(mapDbError(err) ?? {}),
      });
    }
  }

  /**
   * Insert a whole horizon's worth of occurrences in ONE batch.
   *
   * Returns `null` — never throws — when 062's window index or 104's overlap
   * guard refuses one of the rows: the batch is all-or-nothing and cannot say
   * WHICH row lost. Nothing was written, so the caller retries row by row
   * through `create`, where the collision is attributable.
   */
  async createMany(rows: NewShiftData[]): Promise<Shift[] | null> {
    if (rows.length === 0) {
      return [];
    }
    try {
      const results = await db.batch(
        nonEmpty(
          chunk(rows.map(withLocalDate), SHIFT_ROWS_PER_INSERT).map(page =>
            db.insert(shifts).values(page).returning()
          )
        )
      );
      return results.flat() as Shift[];
    } catch (err) {
      if (isRecurringWindowCollision(err) || isCarerWindowOverlap(err)) {
        return null;
      }
      throw new DatabaseError('Failed to create shifts', 'DATABASE_ERROR', {
        details: details(err),
        ...(mapDbError(err) ?? {}),
        count: rows.length,
      });
    }
  }

  async update(id: string, data: Partial<Shift>): Promise<Shift> {
    let rows: unknown[];
    try {
      rows = await db
        .update(shifts)
        .set(await this.withRetimedLocalDate(id, data))
        .where(eq(shifts.id, id))
        .returning();
    } catch (err) {
      // S4a: this is the ONE path that moves a live shift's times in bulk
      // (`applyUpdates`), so it is the one that can re-time an occurrence on
      // top of another of this carer's windows.
      if (isCarerWindowOverlap(err)) {
        throw new ShiftOverlapsError({ shiftId: id });
      }
      throw new DatabaseError('Failed to update shift', 'DATABASE_ERROR', {
        details: details(err),
        id,
      });
    }
    // The old `.single()` errored on zero rows; keep that contract.
    if (!rows[0]) {
      throw new DatabaseError('Failed to update shift', 'DATABASE_ERROR', {
        details: 'No shift with that id',
        id,
      });
    }
    return rows[0] as Shift;
  }

  /** `local_date` follows `starts_at`/`timezone`; the missing half is read from the row. */
  private async withRetimedLocalDate(id: string, data: Partial<Shift>) {
    if (data.starts_at === undefined && data.timezone === undefined) {
      return data;
    }
    let { starts_at: startsAt, timezone } = data;
    if (startsAt === undefined || timezone === undefined) {
      const [current] = await db
        .select({ starts_at: shifts.starts_at, timezone: shifts.timezone })
        .from(shifts)
        .where(eq(shifts.id, id));
      if (!current) return data; // zero-row update; reported by the caller
      startsAt ??= current.starts_at;
      timezone ??= current.timezone;
    }
    return { ...data, local_date: shiftLocalDate(startsAt, timezone) };
  }

  /**
   * Apply the SAME patch to many shifts in one batch. Only ever used for
   * patches that are identical by construction (the cancel patches); a
   * per-shift patch — and anything re-timing a shift — goes through `update`.
   */
  async updateMany(ids: string[], data: Partial<Shift>): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (data.starts_at !== undefined || data.timezone !== undefined) {
      throw new Error('updateMany cannot re-time shifts; use update');
    }
    try {
      await db.batch(
        nonEmpty(
          chunk(ids).map(page =>
            db.update(shifts).set(data).where(inArray(shifts.id, page))
          )
        )
      );
    } catch (err) {
      throw new DatabaseError('Failed to update shifts', 'DATABASE_ERROR', {
        details: details(err),
        count: ids.length,
      });
    }
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    try {
      await db.batch(
        nonEmpty(
          chunk(ids).map(page =>
            db.delete(shifts).where(inArray(shifts.id, page))
          )
        )
      );
    } catch (err) {
      throw new DatabaseError('Failed to delete shifts', 'DATABASE_ERROR', {
        details: details(err),
        count: ids.length,
      });
    }
  }

  /**
   * Replace the children of many shifts wholesale: delete every shift_id's
   * children, insert every child row — one batch for a whole horizon.
   */
  async replaceChildrenMany(
    entries: { shiftId: string; children: NewShiftChildData[] }[]
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    const rows = entries.flatMap(entry =>
      entry.children.map(child => ({ shift_id: entry.shiftId, ...child }))
    );
    try {
      await db.batch(
        nonEmpty([
          ...chunk(entries.map(entry => entry.shiftId)).map(page =>
            db
              .delete(shiftChildren)
              .where(inArray(shiftChildren.shift_id, page))
          ),
          ...chunk(rows, CHILD_ROWS_PER_INSERT).map(page =>
            db.insert(shiftChildren).values(page)
          ),
        ])
      );
    } catch (err) {
      throw new DatabaseError(
        'Failed to replace shift children',
        'DATABASE_ERROR',
        { details: details(err), count: rows.length }
      );
    }
  }
}
