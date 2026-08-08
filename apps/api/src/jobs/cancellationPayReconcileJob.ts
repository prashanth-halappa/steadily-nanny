/**
 * Cancellation-pay reconcile job.
 *
 * `accept_shift_change_request` commits `shifts.cancellation_paid = true` in
 * its own transaction; the payable `time_entries` row is written AFTER it, by
 * `recordCancellationPaidEntry`. If that second write fails, the accept now
 * fails loudly (see `shiftChangeRequestCommandService.respond`) instead of
 * returning 200 on a carer who is owed hours that do not exist — but the
 * failure leaves the flag standing with no entry behind it, and nothing
 * settles it: the endpoint cannot re-drive the accept (its RPC has already
 * CASed the change request off `pending`), no client surfaces the flag, and
 * the carer is simply never paid. This job is the thing that acts on that
 * evidence.
 *
 * Repair is just re-calling `recordCancellationPaidEntry`. Since migration 053
 * a cancelled window can pay out as several fragments (worked time in the
 * MIDDLE leaves two disjoint ones), so idempotency is no longer a find-first
 * on `shift_id`: rows already written come back from the recorder's overlap
 * query and are subtracted from the remainder, so a re-call writes only the
 * genuinely missing gaps and returns `[]` when there are none. That is what
 * makes a half-written remainder repairable rather than invisible, and the
 * unique index on `(shift_id, clock_in_at)` still stops a concurrent accept
 * from duplicating a payable.
 *
 * NOT everything is repairable. `recordCancellationPaidEntry` refuses when the
 * shift's week is already approved (`TimeEntryNotEditableError`,
 * `week_approved`), and no number of retries changes that — the week would
 * have to be reopened, or the shortfall raised to a parent. Those are counted
 * and logged SEPARATELY from transient errors, because they need a human
 * rather than another run. See the report / open product question.
 *
 * SETUP: not scheduled yet — needs a pg_cron migration POSTing
 * `/api/jobs/cancellation-pay-reconcile`, in the shape of
 * `026_schedule_horizon_cron.sql`. Until then it is manual-trigger only.
 *
 * @module jobs/cancellationPayReconcileJob
 */

import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { ShiftRepository } from '../domains/shift/repositories/shiftRepository';
import { TimeEntryNotEditableError } from '../domains/timesheet/errors/timesheetErrors';
import { TimeEntryRepository } from '../domains/timesheet/repositories/timeEntryRepository';
// Import the modules DIRECTLY, never the timesheet barrel — same narrow
// cross-domain dependency `shiftRepository` already takes for the same reason.
import { recordCancellationPaidEntry } from '../domains/timesheet/services/timesheetCommandService';
import { logger } from '../middlewares/logger';

/**
 * How far back to look. Stuck rows stay stuck until repaired, so this is the
 * window in which a repair can still land — long enough to cover a missed run
 * or two, short enough that the scan does not grow forever. An unrepairable
 * `week_approved` row is re-attempted on every run until it ages out, which is
 * the point: it keeps showing up in the logs while it is still actionable.
 */
const LOOKBACK_DAYS = 30;

/** 069: voided did not happen — a voided cancellation-pay row is not pay. */
function isPayableCancellationEntry(entry: TimeEntry | null): boolean {
  return entry !== null && entry.status !== 'voided';
}

export interface CancellationPayReconcileResult {
  checked: number;
  repaired: number;
  needsHumanCount: number;
  /** Flag standing, nothing written, nothing already on file — an unpaid carer. */
  stillUnpaidCount: number;
  errorCount: number;
  message: string;
}

/** The narrow shift-side contract this job depends on, for injecting a fake in tests. */
export type UnsettledCancellationPaidShiftRepository = Pick<
  ShiftRepository,
  'listCancellationPaidSince'
>;

/** The narrow entry-side contract this job depends on, for injecting a fake in tests. */
export type CancellationPaidEntryFinder = Pick<
  TimeEntryRepository,
  'findCancellationPaidForShift'
>;

export async function runCancellationPayReconcileJob(
  shiftRepo: UnsettledCancellationPaidShiftRepository = new ShiftRepository(),
  entries: CancellationPaidEntryFinder = new TimeEntryRepository(),
  // Typed as the array it actually returns, not `unknown`. The `unknown` this
  // used to be is why 053's `TimeEntry | null` → `TimeEntry[]` change landed
  // here without a single compile error.
  recorder: (shift: Shift) => Promise<TimeEntry[]> = recordCancellationPaidEntry
): Promise<CancellationPayReconcileResult> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const shifts = await shiftRepo.listCancellationPaidSince(since);

  let repaired = 0;
  let needsHumanCount = 0;
  let stillUnpaidCount = 0;
  let errorCount = 0;

  for (const shift of shifts) {
    // No pre-flight existence check. Since migration 053 a cancelled window
    // can pay out as SEVERAL fragments, and `findCancellationPaidForShift`
    // only answers "does at least one exist" — which reads a HALF-written
    // remainder as settled and skips the one state this job exists to repair.
    // The recorder is self-healing (already-written rows come back from its
    // overlap query and are subtracted from the remainder), so asking it
    // directly is both the correct question and one query fewer on the happy
    // path. It reports what it actually wrote; `[]` means nothing was owed.
    try {
      const written = await recorder(shift);
      if (written.length === 0) {
        // `[]` usually means settled. It is ALSO what a carer clocked in
        // across the window produces: her open `[clock_in, ∞)` session covers
        // the remainder, so nothing is owed YET and the flag stands over no
        // payable row. That resolves itself once she clocks out and the
        // session becomes a bounded span — but until then it is a silent
        // underpay, and the two cases are identical from here.
        //
        // What separates them is what actually exists. A paid cancellation
        // with NO cancellation entry at all is an unpaid carer whatever the
        // cause, so alarm on that rather than on the running session
        // specifically — it stays correct for causes nobody has hit yet.
        if (
          !isPayableCancellationEntry(
            await entries.findCancellationPaidForShift(shift.id)
          )
        ) {
          stillUnpaidCount++;
          logger.warn(
            'Paid cancellation has no payable entry yet; nothing was owed on this pass',
            {
              shiftId: shift.id,
              householdId: shift.household_id,
              carerId: shift.carer_id,
            }
          );
        }
        continue;
      }
      repaired++;
      logger.info('Reconciled a missing cancellation_paid time entry', {
        shiftId: shift.id,
        householdId: shift.household_id,
        fragments: written.length,
      });
    } catch (error) {
      if (error instanceof TimeEntryNotEditableError) {
        // Deterministic — the week is approved and no retry will settle it.
        //
        // But the recorder checks the approved week BEFORE it computes
        // remainders, so a perfectly settled shift throws this too, and an
        // approved week is the normal end state of every paid cancellation.
        // Escalating those would fire on each run for the whole 30-day
        // lookback and bury the real ones. Existence is the one thing the
        // finder can still answer, and it separates the common healthy case
        // from a genuine "flag set, nothing paid".
        //
        // ponytail: a shift that is PARTIALLY paid on an approved week is
        // indistinguishable from a settled one here and is demoted to this
        // warn — it is equally unrepairable either way, so the choice is only
        // about which log it lands in. Telling them apart needs the remainder
        // arithmetic, which is private to `timesheetCommandService`; export
        // `remainingSpans`, or move the approved-week check below it, to
        // sharpen this.
        if (
          isPayableCancellationEntry(
            await entries.findCancellationPaidForShift(shift.id)
          )
        ) {
          logger.warn(
            'Approved week already carries cancellation pay; nothing to repair',
            { shiftId: shift.id, householdId: shift.household_id }
          );
          continue;
        }
        needsHumanCount++;
        logger.error(
          'Cancellation pay owed on an already-approved week; needs a human',
          {
            shiftId: shift.id,
            householdId: shift.household_id,
            carerId: shift.carer_id,
          }
        );
        continue;
      }
      errorCount++;
      logger.error('Failed to reconcile a cancellation_paid time entry', {
        shiftId: shift.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checked: shifts.length,
    repaired,
    needsHumanCount,
    stillUnpaidCount,
    errorCount,
    message: `Repaired ${repaired} missing cancellation-pay entr(ies) across ${shifts.length} paid cancellation(s); ${needsHumanCount} need a human; ${stillUnpaidCount} still unpaid`,
  };
}
