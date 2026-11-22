/**
 * Busy-block repository — read-only access to the old Postgres
 * `v_busy_blocks` view, rebuilt here as a UNION ALL query (D1 has no view; its
 * definition is at the bottom of db/schema/availability.ts). NOT a
 * `BaseRepository`: there is no CRUD, and it is the SINGLE code path in this codebase
 * that reads a carer's cross-household busy time.
 *
 * "Keep families apart" is a structural privacy promise, not a nicety — the
 * view itself is restricted to 5 columns and this repository's public
 * `listForCarer` additionally selects and maps only `starts_at`, `ends_at`,
 * `kind`. That mapping is defense in depth ON TOP of the `.select()` column
 * restriction: even if a future change to the view or the query widened what
 * came back from the database, the explicit object literal below
 * still strips anything else before it leaves this function. See
 * `AnonymisedBusyBlockSchema` in
 * `packages/shared-types/src/schemas/availability.schema.ts` for the wire
 * contract this mirrors, and its comment on why adding a field here is a
 * privacy regression, not a feature.
 *
 * `listForClashEvaluation` is the server-internal path: it also returns
 * opaque `source_uid` (ical_uid) so clash self-ignore can match by source
 * key without exposing household identity on the public HTTP list.
 *
 * @module domains/availability/repositories/busyBlockRepository
 */
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { carerTimeOff, externalBusyBlocks, shifts } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import type { AnonymisedBusyBlock } from '../types';

/**
 * Instants are ISO TEXT compared lexically, so a caller's `...00Z` must be
 * normalised to the stored `...00.000Z` shape or touching blocks misorder.
 * Unparseable input is passed through unchanged (it simply matches nothing).
 */
export function toInstant(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/**
 * Server-internal busy block for clash evaluation. `source_uid` is the
 * opaque `v_busy_blocks.source_uid` (shift/time-off ical_uid or external
 * event id) — NOT a household-identifying field. Never put this shape on
 * the public busy-blocks HTTP response.
 */
export interface BusyBlockWithSource extends AnonymisedBusyBlock {
  source_uid: string;
}

interface BusyRow {
  starts_at: string;
  ends_at: string;
  kind: string;
  source_uid: string | null;
}

/**
 * The `v_busy_blocks` union for ONE user, overlapping `(from, to)`. The
 * view was security_invoker (RLS-scoped); every branch filters by user here.
 */
async function queryBusyBlocks(
  userId: string,
  from: string,
  to: string
): Promise<BusyRow[]> {
  const f = toInstant(from);
  const t = toInstant(to);
  try {
    return await db
      .select({
        starts_at: shifts.starts_at,
        ends_at: shifts.ends_at,
        kind: sql<string>`'other_commitment'`.as('kind'),
        source_uid: sql<string | null>`${shifts.ical_uid}`.as('source_uid'),
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.carer_id, userId),
          inArray(shifts.status, ['pending', 'confirmed']),
          lt(shifts.starts_at, t),
          gt(shifts.ends_at, f)
        )
      )
      .unionAll(
        db
          .select({
            starts_at: carerTimeOff.starts_at,
            ends_at: carerTimeOff.ends_at,
            kind: sql<string>`'time_off'`.as('kind'),
            source_uid: sql<string | null>`${carerTimeOff.ical_uid}`.as(
              'source_uid'
            ),
          })
          .from(carerTimeOff)
          .where(
            and(
              eq(carerTimeOff.user_id, userId),
              ne(carerTimeOff.status, 'cancelled'),
              lt(carerTimeOff.starts_at, t),
              gt(carerTimeOff.ends_at, f)
            )
          )
      )
      .unionAll(
        db
          .select({
            starts_at: externalBusyBlocks.starts_at,
            ends_at: externalBusyBlocks.ends_at,
            kind: sql<string>`'personal'`.as('kind'),
            source_uid: sql<
              string | null
            >`${externalBusyBlocks.external_event_id}`.as('source_uid'),
          })
          .from(externalBusyBlocks)
          .where(
            and(
              eq(externalBusyBlocks.user_id, userId),
              ne(externalBusyBlocks.opacity, 'free'),
              lt(externalBusyBlocks.starts_at, t),
              gt(externalBusyBlocks.ends_at, f)
            )
          )
      );
  } catch (err) {
    const error = new DatabaseError(
      'Failed to list busy blocks',
      'DATABASE_ERROR',
      {
        details: err instanceof Error ? err.message : String(err),
        carerId: userId,
      }
    );
    error.cause = err;
    throw error;
  }
}

export class BusyBlockRepository {
  /**
   * Busy blocks for `carerId` overlapping `[from, to]` — public wire shape
   * (`starts_at`, `ends_at`, `kind` only).
   *
   * Overlap semantics (deliberate choice): a block is included when it
   * STARTS before `to` AND ENDS after `from` — the standard interval-overlap
   * test — so a block that only partially overlaps the requested window
   * (e.g. starts the day before `from` and runs into it) is still returned,
   * not just blocks fully contained inside `[from, to]`. Both comparisons are
   * strict so a block that ends exactly at `from` or starts exactly at `to`
   * (touching, not overlapping) is excluded.
   */
  async listForCarer(
    carerId: string,
    from: string,
    to: string
  ): Promise<AnonymisedBusyBlock[]> {
    const rows = await queryBusyBlocks(carerId, from, to);
    // Explicit field-by-field mapping — defense in depth #2 (see module doc).
    // Never spread a raw row here; only ever these three named fields.
    return rows.map(row => ({
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      kind: row.kind as AnonymisedBusyBlock['kind'],
    }));
  }

  /**
   * Same window as `listForCarer`, plus opaque `source_uid` for clash
   * self-ignore. Server-internal only — do not return this from HTTP handlers
   * that serve `AnonymisedBusyBlockListResponseSchema`.
   */
  async listForClashEvaluation(
    carerId: string,
    from: string,
    to: string
  ): Promise<BusyBlockWithSource[]> {
    const rows = await queryBusyBlocks(carerId, from, to);
    return rows.map(row => ({
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      kind: row.kind as AnonymisedBusyBlock['kind'],
      source_uid: row.source_uid ?? '',
    }));
  }
}
