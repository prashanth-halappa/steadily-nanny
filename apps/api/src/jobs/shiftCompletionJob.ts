/**
 * Nightly shift completion (S2 · D-24).
 *
 * `shifts.status` has carried `completed` since migration 015 — in the CHECK
 * constraint, in `IMMUTABLE_STATUSES`, in `COVERING_SHIFT_STATUSES` — and
 * nothing has ever written it. Every worked shift has sat at `confirmed`
 * forever, so "what we agreed" and "what happened" are the same row and
 * scheduled-versus-worked reconciliation has nothing to reconcile against.
 * David's name for it: the quiet accomplice. This job is the writer.
 *
 * NO PUSH, ever (spec §1.6). A buzz saying "your shift finished" tells nobody
 * anything they were not present for. The status surfaces on the day rows and
 * in the reconciliation it enables — that IS the delivery.
 *
 * BATCHED, NEVER PER-ROW (GOLDEN-FIXES #28). One `UPDATE ... WHERE status =
 * 'confirmed' AND ends_at < cutoff` per run, whatever the row count. A per-row
 * loop against a hosted database is the mistake that made accepting a usual
 * week take 26 seconds, and a night's shifts across every household is a
 * bigger loop than that one was.
 *
 * IMMUTABILITY IS RESPECTED BY CONSTRUCTION. `IMMUTABLE_STATUSES` is
 * {completed, cancelled} and the WHERE clause is `status = 'confirmed'`, so no
 * immutable row is ever in scope — which is also why the job must not route
 * through `ShiftRepository.update`: that method's `assertMutable` additionally
 * refuses rows with time entries, a guard about editing a shift's TERMS, not
 * about closing it. A shift with time entries behind it is precisely the thing
 * that should end up `completed`.
 *
 * DRAFT AND PENDING ARE OUT OF SCOPE, deliberately. A shift nobody ever
 * accepted did not "complete" — it lapsed, and saying otherwise would put a
 * worked-looking row in the record for a morning nobody turned up to. Their
 * fate belongs to the ask lifecycle (`coverAskExpiryJob`), not here.
 *
 * SETUP: scheduled nightly via pg_cron in migration
 * `089_shift_completion_cron.sql` (POST `/api/jobs/shift-completion`) — a repo
 * file only, never applied (Phase 3 slice scope; Phase 6 applies it).
 *
 * @module jobs/shiftCompletionJob
 */

import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../config/supabase';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';

/**
 * How long after `ends_at` a shift is considered finished business.
 *
 * A grace period rather than a household-local midnight gate, which is what
 * lets a single nightly UTC tick be correct in every timezone. Two hours is
 * comfortably past any clock-out a carer is still going to make (the no-show
 * window itself closes at 2h) while staying well inside the same night.
 */
export const COMPLETION_GRACE_MS = 2 * 60 * 60 * 1000;

/** The one DB call this job makes — narrow, so tests can fake it. */
export interface ShiftCompletionWriter {
  /** CAS `confirmed` → `completed` for every shift ended before `cutoffIso`. */
  completeEndedBefore(cutoffIso: string): Promise<Array<Pick<Shift, 'id'>>>;
}

export interface ShiftCompletionJobResult {
  completedCount: number;
  errorCount: number;
  message: string;
}

export class DefaultShiftCompletionWriter implements ShiftCompletionWriter {
  async completeEndedBefore(
    cutoffIso: string
  ): Promise<Array<Pick<Shift, 'id'>>> {
    const { data, error } = await supabaseService
      .from('shifts')
      // `.eq('status', CONFIRMED)` is doing double duty: it selects the work
      // AND it is the compare-and-set that keeps an immutable row out of
      // scope. Widening it is not a filter change, it is a guard removal.
      .update({ status: SHIFT_STATUSES.COMPLETED })
      .eq('status', SHIFT_STATUSES.CONFIRMED)
      .lt('ends_at', cutoffIso)
      .select('id');

    if (error) {
      throw new DatabaseError(
        'Failed to complete past confirmed shifts',
        'DATABASE_ERROR',
        { details: error.message, cutoffIso }
      );
    }
    return (data ?? []) as Array<Pick<Shift, 'id'>>;
  }
}

export async function runShiftCompletionJob(
  writer: ShiftCompletionWriter = new DefaultShiftCompletionWriter(),
  clock: { now: () => Date } = { now: () => new Date() }
): Promise<ShiftCompletionJobResult> {
  const cutoff = new Date(
    clock.now().getTime() - COMPLETION_GRACE_MS
  ).toISOString();

  try {
    const completed = await writer.completeEndedBefore(cutoff);
    return {
      completedCount: completed.length,
      errorCount: 0,
      message: `Completed ${completed.length} past confirmed shift(s)`,
    };
  } catch (error) {
    logger.error('Shift completion job failed', { cutoff, error });
    return {
      completedCount: 0,
      errorCount: 1,
      message: 'Shift completion job failed',
    };
  }
}
