/**
 * Cloudflare Cron Trigger → job runners.
 *
 * ONE trigger (`* * * * *` in wrangler.jsonc) fires every minute; each tick
 * runs every job whose own cron expression matches that minute (UTC). One
 * trigger keeps the Workers free plan (5-trigger cap) while each job keeps its
 * original schedule. Each job is the SAME tracked handler as the HTTP route
 * (job_runs row, Sentry, error-count semantics), called directly.
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

/** The single trigger in wrangler.jsonc; it must stay every-minute. */
export const TICK_CRON = '* * * * *';

/** One cron field (`*`, `n`, `a-b`, `*\/n`, `a-b/n`, comma lists) against a value. */
function fieldMatches(field: string, value: number, min: number, max: number) {
  return field.split(',').some(part => {
    const [range = '*', stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    const [lo, hi] =
      range === '*'
        ? [min, max]
        : range.includes('-')
          ? range.split('-').map(Number)
          : [Number(range), stepRaw === undefined ? Number(range) : max];
    if (lo === undefined || hi === undefined) return false;
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

/**
 * Does a 5-field cron expression match this instant (UTC, minute precision)?
 * ponytail: day-of-month and day-of-week are ANDed, not cron's OR; every
 * schedule here uses `*` for both. Implement the OR rule before adding one
 * that restricts both.
 */
export function cronMatches(expr: string, at: Date): boolean {
  const [minute, hour, dom, month, dow] = expr.trim().split(/\s+/);
  if (!minute || !hour || !dom || !month || !dow) return false;
  return (
    fieldMatches(minute, at.getUTCMinutes(), 0, 59) &&
    fieldMatches(hour, at.getUTCHours(), 0, 23) &&
    fieldMatches(dom, at.getUTCDate(), 1, 31) &&
    fieldMatches(month, at.getUTCMonth() + 1, 1, 12) &&
    fieldMatches(dow, at.getUTCDay(), 0, 6)
  );
}

export async function scheduled(
  controller: { cron: string; scheduledTime: number },
  _env?: unknown,
  _ctx?: unknown
): Promise<void> {
  // scheduledTime is the minute the tick was FOR, so a late tick still
  // matches the right jobs.
  const at = new Date(controller.scheduledTime);
  const due = Object.entries(CRON_JOBS).filter(([expr]) =>
    cronMatches(expr, at)
  );
  // run() already logs, reports to Sentry and records job_runs; the catch only
  // keeps one failing job from rejecting the tick for the others.
  await Promise.all(
    due.map(([, entry]) =>
      entry.job.run().catch(error => {
        console.error(`[scheduled] ${entry.name} failed:`, error);
      })
    )
  );
}
