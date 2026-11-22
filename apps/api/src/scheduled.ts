/**
 * Cloudflare Cron Triggers → job runners.
 *
 * Replaces the pg_cron → pg_net → POST /api/jobs/* chain the API used
 * before the move to Workers. Each trigger calls the SAME tracked job as the HTTP route (job_runs
 * row, Sentry, error-count semantics) directly — no HTTP hop, no job API key.
 * The cron strings here MUST match `triggers.crons` in wrangler.jsonc exactly.
 *
 * @module scheduled
 */
import { JobController } from './controllers/jobController';
import type { TrackedJobHandler } from './controllers/jobHandlerFactory';

export const CRON_JOBS: Record<
  string,
  { name: string; job: TrackedJobHandler }
> = {
  '0 3 * * *': {
    name: 'schedule-horizon',
    job: JobController.runScheduleHorizon,
  },
  '5 * * * *': { name: 'reminders', job: JobController.runReminders },
  '25 * * * *': {
    name: 'cancellation-pay-reconcile',
    job: JobController.runCancellationPayReconcile,
  },
  '10 4 * * *': {
    name: 'integrity-checks',
    job: JobController.runIntegrityChecks,
  },
  '*/10 * * * *': { name: 'no-show-sweep', job: JobController.runNoShowSweep },
  '35 * * * *': {
    name: 'uncovered-digest',
    job: JobController.runUncoveredDigest,
  },
  '3-58/5 * * * *': {
    name: 'cover-ask-expiry',
    job: JobController.runCoverAskExpiry,
  },
  '40 3 * * *': {
    name: 'shift-completion',
    job: JobController.runShiftCompletion,
  },
  '50 * * * *': { name: 'no-show-digest', job: JobController.runNoShowDigest },
  '15 6 * * *': { name: 'job-health', job: JobController.runJobHealth },
};

export async function scheduled(
  controller: { cron: string },
  _env?: unknown,
  _ctx?: unknown
): Promise<void> {
  const entry = CRON_JOBS[controller.cron];
  if (!entry) {
    console.error(
      `[scheduled] no job registered for cron "${controller.cron}"`
    );
    return;
  }
  // run() already logs + reports failures to Sentry and records job_runs; the
  // catch only keeps the scheduled invocation from rejecting.
  await entry.job.run().catch(error => {
    console.error(`[scheduled] ${entry.name} failed:`, error);
  });
}
