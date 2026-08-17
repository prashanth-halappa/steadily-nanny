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
 * DRAFT AND PENDING ARE NEVER *COMPLETED*, deliberately. A shift nobody ever
 * accepted did not "complete" — it lapsed, and saying otherwise would put a
 * worked-looking row in the record for a morning nobody turned up to.
 *
 * BUT THEY DO HAVE TO END SOMEWHERE (audit S5). A RECURRING shift left
 * `pending` past its own end was resolved by NOTHING: `coverAskExpiryJob`
 * covers `extra`/`cover` asks only, this sweep covers `confirmed` only, and
 * `noShowJob` requires `confirmed` — so the shift sat `pending` forever and
 * the family was never told it had been missed either. It is reachable from
 * the silent re-materialisation demotion (`applyOneUpdate`), which is why
 * that path now pushes too. The second arm below closes it.
 *
 * THE LAPSE LANDS ON `cancelled` WITH `cancelled_by = NULL`, NEVER
 * `declined`. 088's rule, and it is worth quoting: "`declined` — LIES. It
 * says the carer answered." She did not answer; the question expired around
 * her. `cancelled` + a null actor is exactly the discriminator cover-ask
 * expiry already uses for "nobody acted", and a `unconfirmed_shift_lapsed`
 * day-thread row records it where a human will see it.
 *
 * NO GRACE PERIOD ON THAT ARM. The two hours exist to let a late clock-out
 * land. There is no clock-out coming for a shift nobody accepted, so its
 * cutoff is plain `now`.
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

/** A recurring shift that ended still `pending` — enough of it to write its day-thread row. */
export interface EndedPendingShift {
  id: string;
  household_id: string;
  local_date: string;
}

/** One `unconfirmed_shift_lapsed` day-thread row. */
export interface LapsedShiftEvent {
  household_id: string;
  shift_id: string;
  local_date: string;
  actor_id: null;
  event_type: 'unconfirmed_shift_lapsed';
  payload: { key: string };
}

/** The DB calls this job makes — narrow, so tests can fake them. */
export interface ShiftCompletionWriter {
  /** Confirmed shifts that ended before `cutoffIso`, each tagged worked/not. */
  listEndedConfirmed(cutoffIso: string): Promise<EndedConfirmedShift[]>;
  /** CAS `confirmed` → `completed` for exactly these ids. */
  completeByIds(shiftIds: string[]): Promise<Array<Pick<Shift, 'id'>>>;
  /** RECURRING shifts still `pending` whose window ended before `cutoffIso`. */
  listEndedPendingRecurring(cutoffIso: string): Promise<EndedPendingShift[]>;
  /** CAS `pending` → `cancelled` with a NULL `cancelled_by`, for exactly these ids. */
  lapseByIds(shiftIds: string[]): Promise<Array<Pick<Shift, 'id'>>>;
  /** Append the day-thread rows for a lapse batch. Keyed, so a re-run cannot double up. */
  appendLapsedEvents(events: LapsedShiftEvent[]): Promise<void>;
}

export interface ShiftCompletionJobResult {
  completedCount: number;
  /** Past confirmed shifts left alone because nobody logged any hours. */
  skippedCount: number;
  /** Past RECURRING shifts nobody ever answered, resolved to `cancelled` (S5). */
  lapsedCount: number;
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

  async listEndedPendingRecurring(
    cutoffIso: string
  ): Promise<EndedPendingShift[]> {
    const { data, error } = await supabaseService
      .from('shifts')
      .select('id, household_id, local_date')
      .eq('status', SHIFT_STATUSES.PENDING)
      .eq('kind', 'recurring')
      .lt('ends_at', cutoffIso);

    if (error) {
      throw new DatabaseError(
        'Failed to list past pending recurring shifts',
        'DATABASE_ERROR',
        { details: error.message, cutoffIso }
      );
    }
    return (data ?? []) as EndedPendingShift[];
  }

  async lapseByIds(shiftIds: string[]): Promise<Array<Pick<Shift, 'id'>>> {
    const { data, error } = await supabaseService
      .from('shifts')
      .update({
        status: SHIFT_STATUSES.CANCELLED,
        // NOT `declined`, and NOT an actor: nobody answered. Same
        // discriminator migration 088 gives cover-ask expiry.
        cancelled_by: null,
        cancelled_at: new Date().toISOString(),
        cancellation_paid: false,
        reason: 'unconfirmed_shift_lapsed',
      })
      // Doing double duty, exactly as in `completeByIds`: it selects the work
      // AND it is the compare-and-set that keeps a shift somebody accepted in
      // the meantime out of scope. Widening it is a guard removal.
      .eq('status', SHIFT_STATUSES.PENDING)
      .in('id', shiftIds)
      .select('id');

    if (error) {
      throw new DatabaseError(
        'Failed to lapse past pending recurring shifts',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    return (data ?? []) as Array<Pick<Shift, 'id'>>;
  }

  async appendLapsedEvents(events: LapsedShiftEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const { error } = await supabaseService.from('shift_events').insert(events);

    if (error) {
      throw new DatabaseError(
        'Failed to record unconfirmed_shift_lapsed events',
        'DATABASE_ERROR',
        { details: error.message, count: events.length }
      );
    }
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
  const now = clock.now();
  const cutoff = new Date(now.getTime() - COMPLETION_GRACE_MS).toISOString();

  let completedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    const candidates = await writer.listEndedConfirmed(cutoff);
    const workedIds = candidates.filter(row => row.worked).map(row => row.id);
    skippedCount = candidates.length - workedIds.length;

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
    completedCount = completed.length;
  } catch (error) {
    logger.error('Shift completion job failed', { cutoff, error });
    errorCount += 1;
  }

  // The two arms are independent: a shift that ended `confirmed` and a shift
  // that ended `pending` share nothing but this schedule, so one failing must
  // not swallow the other's work.
  const lapsedCount = await lapseUnconfirmedRecurring(writer, now).catch(
    error => {
      logger.error('Shift lapse sweep failed', { error });
      errorCount += 1;
      return 0;
    }
  );

  return {
    completedCount,
    skippedCount,
    lapsedCount,
    errorCount,
    message:
      `Completed ${completedCount} past confirmed shift(s), left ${skippedCount} with no hours, ` +
      `lapsed ${lapsedCount} unanswered recurring shift(s)`,
  };
}

/**
 * S5. No grace period: the two hours exist to let a late clock-out land, and
 * nobody is clocking into a shift they never accepted.
 */
async function lapseUnconfirmedRecurring(
  writer: ShiftCompletionWriter,
  now: Date
): Promise<number> {
  const stale = await writer.listEndedPendingRecurring(now.toISOString());
  if (stale.length === 0) {
    return 0;
  }

  const lapsed = await writer.lapseByIds(stale.map(shift => shift.id));
  if (lapsed.length === 0) {
    return 0;
  }

  // Only the rows the CAS actually won — a shift somebody accepted between
  // the read and the write is not lapsed and must not be told it was.
  const lapsedIds = new Set(lapsed.map(row => row.id));
  await writer.appendLapsedEvents(
    stale
      .filter(shift => lapsedIds.has(shift.id))
      .map(shift => ({
        household_id: shift.household_id,
        shift_id: shift.id,
        local_date: shift.local_date,
        actor_id: null as null,
        event_type: 'unconfirmed_shift_lapsed' as const,
        // Keyed so migration 025's partial unique index dedupes a re-run.
        payload: { key: shift.id },
      }))
  );

  logger.info('Shift lapse: resolved unanswered recurring shifts', {
    lapsedCount: lapsed.length,
  });
  return lapsed.length;
}
