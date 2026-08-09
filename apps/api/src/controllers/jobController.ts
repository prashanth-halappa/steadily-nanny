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
import { runExampleMaintenanceJob } from '../jobs/exampleMaintenanceJob';
import { runIntegrityCheckJob } from '../jobs/integrityCheckJob';
import { runNoShowJob } from '../jobs/noShowJob';
import { runReminderJob } from '../jobs/reminderJob';
import { runScheduleHorizonJob } from '../jobs/scheduleHorizonJob';
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

  /** POST /api/jobs/cancellation-pay-reconcile */
  runCancellationPayReconcile: createTrackedJobHandler(
    'cancellation-pay-reconcile',
    runCancellationPayReconcileJob,
    'Cancellation pay reconcile job completed',
    { mapForJobRun: mapReconcileForJobRun }
  ),
};
