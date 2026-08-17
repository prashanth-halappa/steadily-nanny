/**
 * Job controller.
 *
 * HTTP handlers for scheduled-job endpoints, built with the job handler
 * factories. Add one line per job.
 *
 * @module controllers/jobController
 */
import type { CancellationPayReconcileResult } from '../jobs/cancellationPayReconcileJob';
import { runCancellationPayReconcileJob } from '../jobs/cancellationPayReconcileJob';
import { runCoverAskExpiryJob } from '../jobs/coverAskExpiryJob';
import { runExampleMaintenanceJob } from '../jobs/exampleMaintenanceJob';
import { runIntegrityCheckJob } from '../jobs/integrityCheckJob';
import type { JobHealthJobResult } from '../jobs/jobHealthJob';
import { runJobHealthJob } from '../jobs/jobHealthJob';
import { runNoShowDigestJob } from '../jobs/noShowDigestJob';
import { runNoShowJob } from '../jobs/noShowJob';
import { runReminderJob } from '../jobs/reminderJob';
import { runScheduleHorizonJob } from '../jobs/scheduleHorizonJob';
import { runShiftCompletionJob } from '../jobs/shiftCompletionJob';
import { runUncoveredDigestJob } from '../jobs/uncoveredDigestJob';
import { createTrackedJobHandler } from './jobHandlerFactory';

/**
 * Fold `needsHumanCount` into `errorCount` — and only that one.
 *
 * `needsHumanCount` is pay owed on an already-approved week: deterministically
 * unrepairable, no retry settles it, so it should fail the run and page.
 *
 * `stillUnpaidCount` is deliberately NOT folded. Its common cause is a carer
 * clocked in across the cancelled window — the remainder computes to empty
 * until she clocks out, then settles itself. Folding it fired a failed run, a
 * 500 and a Sentry event on every hourly pass of an overnight session, roughly
 * sixteen pages for a state that was never wrong. The genuinely stuck version
 * is caught by migration 056's `cancellation_unsettled` check, which waits two
 * hours and reports once a day. Both counts stay in the summary either way, so
 * the `job_runs` row still says which kind of outcome it was.
 */
export function mapReconcileForJobRun(result: CancellationPayReconcileResult) {
  return {
    totalProcessed: result.checked,
    successCount: result.repaired,
    errorCount: result.errorCount + result.needsHumanCount,
    needsHumanCount: result.needsHumanCount,
    stillUnpaidCount: result.stillUnpaidCount,
  };
}

/**
 * Fold `issueCount` into `errorCount` — and only that one.
 *
 * An unhealthy job-health run (some OTHER registered job is stale/failed)
 * must fail loudly through the same 500 + Sentry path every other job gets,
 * which is the whole point of this job existing. This job's OWN `errorCount`
 * (a `job_runs`/pg_net query that itself threw) is reported separately in
 * the summary so a human can tell "job-health is broken" from "job-health
 * found something broken".
 */
export function mapJobHealthForJobRun(result: JobHealthJobResult) {
  return {
    errorCount: result.errorCount + result.issueCount,
    healthy: result.healthy,
    issueCount: result.issueCount,
    alerted: result.alerted,
    issues: result.issues,
  };
}

export const JobController = {
  /** POST /api/jobs/example-maintenance */
  runExampleMaintenance: createTrackedJobHandler(
    'example-maintenance',
    runExampleMaintenanceJob,
    'Example maintenance job completed'
  ),

  /** POST /api/jobs/schedule-horizon */
  runScheduleHorizon: createTrackedJobHandler(
    'schedule-horizon',
    runScheduleHorizonJob,
    'Schedule horizon job completed',
    {
      mapForJobRun: result => ({
        totalProcessed: result.patternsProcessed,
        successCount: result.successCount,
        errorCount: result.errorCount,
      }),
    }
  ),

  /** POST /api/jobs/reminders */
  runReminders: createTrackedJobHandler(
    'reminders',
    runReminderJob,
    'Reminders job completed',
    {
      mapForJobRun: result => ({
        errorCount: result.errorCount,
        shiftReminder: result.shiftReminder,
        timesheetAwaitingApproval: result.timesheetAwaitingApproval,
        scheduleNotSet: result.scheduleNotSet,
      }),
    }
  ),

  /**
   * POST /api/jobs/integrity-checks
   *
   * No `mapForJobRun`: the job's own `errorCount` is already the violation
   * total, which is exactly what must fail the run.
   */
  runIntegrityChecks: createTrackedJobHandler(
    'integrity-checks',
    runIntegrityCheckJob,
    'Integrity checks completed'
  ),

  /** POST /api/jobs/no-show-sweep */
  runNoShowSweep: createTrackedJobHandler(
    'no-show-sweep',
    runNoShowJob,
    'No-show sweep completed',
    {
      mapForJobRun: result => ({
        totalProcessed: result.noShow.candidates,
        successCount: result.noShow.sent,
        errorCount: result.errorCount,
        noShow: result.noShow,
      }),
    }
  ),

  /** POST /api/jobs/no-show-digest */
  runNoShowDigest: createTrackedJobHandler(
    'no-show-digest',
    runNoShowDigestJob,
    'No-show digest completed',
    {
      mapForJobRun: result => ({
        totalProcessed: result.digest.candidates,
        successCount: result.digest.sent,
        errorCount: result.errorCount,
        digest: result.digest,
      }),
    }
  ),

  /** POST /api/jobs/cover-ask-expiry — S1/D-47, every 5 minutes. */
  runCoverAskExpiry: createTrackedJobHandler(
    'cover-ask-expiry',
    runCoverAskExpiryJob,
    'Cover-ask expiry completed',
    {
      mapForJobRun: result => ({
        totalProcessed: result.expiry.candidates,
        successCount: result.expiredCount,
        errorCount: result.errorCount,
        expiry: result.expiry,
      }),
    }
  ),

  /** POST /api/jobs/shift-completion — S2/D-24, nightly. No push, ever. */
  runShiftCompletion: createTrackedJobHandler(
    'shift-completion',
    runShiftCompletionJob,
    'Shift completion completed',
    {
      mapForJobRun: result => ({
        // Candidates, not writes: a past confirmed shift with no hours behind
        // it was looked at and deliberately left alone, and the difference
        // between the two numbers IS the no-show backlog.
        totalProcessed: result.completedCount + result.skippedCount,
        successCount: result.completedCount,
        errorCount: result.errorCount,
      }),
    }
  ),

  /** POST /api/jobs/cancellation-pay-reconcile */
  runCancellationPayReconcile: createTrackedJobHandler(
    'cancellation-pay-reconcile',
    runCancellationPayReconcileJob,
    'Cancellation pay reconcile job completed',
    { mapForJobRun: mapReconcileForJobRun }
  ),

  /** POST /api/jobs/uncovered-digest */
  runUncoveredDigest: createTrackedJobHandler(
    'uncovered-digest',
    runUncoveredDigestJob,
    'Uncovered digest completed',
    {
      mapForJobRun: result => ({
        totalProcessed: result.digest.candidates,
        successCount: result.digest.sent,
        errorCount: result.errorCount,
        digest: result.digest,
      }),
    }
  ),

  /** POST /api/jobs/job-health — J1-b (S2), daily via 105. */
  runJobHealth: createTrackedJobHandler(
    'job-health',
    runJobHealthJob,
    'Job health check completed',
    { mapForJobRun: mapJobHealthForJobRun }
  ),
};
