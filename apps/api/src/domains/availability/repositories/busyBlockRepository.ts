/**
 * Busy-block repository — read-only access to the `v_busy_blocks` view (see
 * supabase/migrations/016_calendar_seams.sql). NOT a `BaseRepository`: this
 * is a view with no CRUD, and it is the SINGLE code path in this codebase
 * that reads a carer's cross-household busy time.
 *
 * "Keep families apart" is a structural privacy promise, not a nicety — the
 * view itself is restricted to 5 columns and this repository's public
 * `listForCarer` additionally selects and maps only `starts_at`, `ends_at`,
 * `kind`. That mapping is defense in depth ON TOP of the `.select()` column
 * restriction: even if a future change to the view or the query widened what
 * came back over the wire from Supabase, the explicit object literal below
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
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import type { AnonymisedBusyBlock } from '../types';

/**
 * Server-internal busy block for clash evaluation. `source_uid` is the
 * opaque `v_busy_blocks.source_uid` (shift/time-off ical_uid or external
 * event id) — NOT a household-identifying field. Never put this shape on
 * the public busy-blocks HTTP response.
 */
export interface BusyBlockWithSource extends AnonymisedBusyBlock {
  source_uid: string;
}

export class BusyBlockRepository {
  private readonly view = 'v_busy_blocks';

  /**
   * Busy blocks for `carerId` overlapping `[from, to]` — public wire shape
   * (`starts_at`, `ends_at`, `kind` only).
   *
   * Overlap semantics (deliberate choice): a block is included when it
   * STARTS before `to` AND ENDS after `from` — the standard interval-overlap
   * test — so a block that only partially overlaps the requested window
   * (e.g. starts the day before `from` and runs into it) is still returned,
   * not just blocks fully contained inside `[from, to]`. `.lt`/`.gt` (both
   * strict) are used rather than `.lte`/`.gte` so a block that ends exactly
   * at `from` or starts exactly at `to` (touching, not overlapping) is
   * excluded.
   */
  async listForCarer(
    carerId: string,
    from: string,
    to: string
  ): Promise<AnonymisedBusyBlock[]> {
    const { data, error } = await supabaseService
      .from(this.view)
      .select('starts_at, ends_at, kind')
      .eq('user_id', carerId)
      .lt('starts_at', to)
      .gt('ends_at', from);

    if (error) {
      throw new DatabaseError('Failed to list busy blocks', 'DATABASE_ERROR', {
        details: error.message,
        carerId,
      });
    }

    const rows = (data ?? []) as {
      starts_at: string;
      ends_at: string;
      kind: string;
    }[];

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
    const { data, error } = await supabaseService
      .from(this.view)
      .select('starts_at, ends_at, kind, source_uid')
      .eq('user_id', carerId)
      .lt('starts_at', to)
      .gt('ends_at', from);

    if (error) {
      throw new DatabaseError('Failed to list busy blocks', 'DATABASE_ERROR', {
        details: error.message,
        carerId,
      });
    }

    // View typing in generated Database may lag `source_uid`; cast via unknown.
    const rows = (data ?? []) as unknown as {
      starts_at: string;
      ends_at: string;
      kind: string;
      source_uid: string | null;
    }[];

    return rows.map(row => ({
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      kind: row.kind as AnonymisedBusyBlock['kind'],
      source_uid: row.source_uid ?? '',
    }));
  }
}
