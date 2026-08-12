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
 * BATCHED, NEVER PER-ROW (GOLDEN-FIXES #28). Three queries per run, whatever
 * the row count: the candidates, the shift ids that have hours behind them,
 * and one `UPDATE ... WHERE status = 'confirmed' AND id IN (...)`. A per-row
 * loop against a hosted database is the mistake that made accepting a usual
 * week take 26 seconds, and a night's shifts across every household is a
 * bigger loop than that one was.
 *
 * A SHIFT WITH NO HOURS BEHIND IT IS NOT COMPLETED, and this is the one rule
 * worth reading twice. `noShowJob` never changes `shifts.status` — it writes
 * pushes and nothing else — so a shift the carer NO-SHOWED is still
 * `confirmed` when this sweep runs at 03:40. Completing it would write a
 * worked-looking row for a morning nobody turned up to, and `completed` is in
 * `IMMUTABLE_STATUSES`, so it could never be corrected. 089's header argued
 * only that shifts WITH entries belong in scope; it never claimed the
 * zero-entry case did.
 *
 * They stay `confirmed`, deliberately, rather than getting a distinguishing
 * mark: `confirmed` is already the honest reading ("this is what we agreed,
 * and nothing has closed it"), it needs no new column, and it stays MUTABLE —
 * so the day a parent adds the missed hours, the next night's sweep completes
 * it for free. The count is logged each run rather than dropped in silence.
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

/** A candidate, and whether anybody actually worked it. */
export interface EndedConfirmedShift {
  id: string;
  /** At least one non-voided time entry is attached (069: voided did not happen). */
  worked: boolean;
}

/** The DB calls this job makes — narrow, so tests can fake them. */
export interface ShiftCompletionWriter {
  /** Confirmed shifts that ended before `cutoffIso`, each tagged worked/not. */
  listEndedConfirmed(cutoffIso: string): Promise<EndedConfirmedShift[]>;
  /** CAS `confirmed` → `completed` for exactly these ids. */
  completeByIds(shiftIds: string[]): Promise<Array<Pick<Shift, 'id'>>>;
}

export interface ShiftCompletionJobResult {
  completedCount: number;
  /** Past confirmed shifts left alone because nobody logged any hours. */
  skippedCount: number;
  errorCount: number;
  message: string;
}

export class DefaultShiftCompletionWriter implements ShiftCompletionWriter {
  async listEndedConfirmed(cutoffIso: string): Promise<EndedConfirmedShift[]> {
    const { data, error } = await supabaseService
      .from('shifts')
      .select('id')
      .eq('status', SHIFT_STATUSES.CONFIRMED)
      .lt('ends_at', cutoffIso);

    if (error) {
      throw new DatabaseError(
        'Failed to list past confirmed shifts',
        'DATABASE_ERROR',
        { details: error.message, cutoffIso }
      );
    }
    const ids = ((data ?? []) as Array<Pick<Shift, 'id'>>).map(row => row.id);
    if (ids.length === 0) {
      return [];
    }

    const worked = await this.shiftIdsWithEntries(ids);
    return ids.map(id => ({ id, worked: worked.has(id) }));
  }

  /** ONE query for the whole batch, never one per shift (GOLDEN-FIXES #28). */
  private async shiftIdsWithEntries(shiftIds: string[]): Promise<Set<string>> {
    const { data, error } = await supabaseService
      .from('time_entries')
      .select('shift_id')
      .in('shift_id', shiftIds)
      // 069: a voided entry did not happen, so it is not evidence anybody
      // worked — same reading `noShowJob`'s coverage test takes.
      .neq('status', 'voided');

    if (error) {
      throw new DatabaseError(
        'Failed to load time entries for the shift-completion sweep',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return new Set(
      ((data ?? []) as Array<{ shift_id: string | null }>)
        .map(row => row.shift_id)
        .filter((id): id is string => id !== null)
    );
  }

  async completeByIds(shiftIds: string[]): Promise<Array<Pick<Shift, 'id'>>> {
    const { data, error } = await supabaseService
      .from('shifts')
      // `.eq('status', CONFIRMED)` is doing double duty: it selects the work
      // AND it is the compare-and-set that keeps an immutable row out of
      // scope. Widening it is not a filter change, it is a guard removal.
      .update({ status: SHIFT_STATUSES.COMPLETED })
      .eq('status', SHIFT_STATUSES.CONFIRMED)
      .in('id', shiftIds)
      .select('id');

    if (error) {
      throw new DatabaseError(
        'Failed to complete past confirmed shifts',
        'DATABASE_ERROR',
        { details: error.message }
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
    const candidates = await writer.listEndedConfirmed(cutoff);
    const workedIds = candidates.filter(row => row.worked).map(row => row.id);
    const skippedCount = candidates.length - workedIds.length;

    if (skippedCount > 0) {
      // Not a silent skip: this count IS the no-show backlog, and a number
      // that climbs is worth someone seeing.
      logger.info(
        'Shift completion: leaving past confirmed shifts with no hours alone',
        { skippedCount, cutoff }
      );
    }

    const completed =
      workedIds.length > 0 ? await writer.completeByIds(workedIds) : [];

    return {
      completedCount: completed.length,
      skippedCount,
      errorCount: 0,
      message: `Completed ${completed.length} past confirmed shift(s), left ${skippedCount} with no hours`,
    };
  } catch (error) {
    logger.error('Shift completion job failed', { cutoff, error });
    return {
      completedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      message: 'Shift completion job failed',
    };
  }
}
