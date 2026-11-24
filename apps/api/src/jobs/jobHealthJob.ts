/**
 * Job-health job (J1-b, closing S2).
 *
 * S2's finding: all registered cron jobs post through `net.http_post`, which
 * is asynchronous — `cron.job_run_details.status = 'succeeded'` proves only
 * that pg_net accepted the enqueue, never that the API call it fired
 * actually ran. `net._http_response` (where the real outcome lands) has zero
 * readers repo-wide, and pg_net's own retention is short. `job_runs` is the
 * one table every job actually writes its own outcome to (J1-a made every
 * sweep honest about that), so this job is the automated surface that reads
 * it and pages someone when it disagrees with "cron said success".
 *
 * TWO independent signals, both read from `job_runs`:
 *  (i)  is each of the 9 registered jobs' latest SUCCESS recent enough for
 *       its own cadence, and did any job fail/partial in the last 24h.
 *  (ii) did each job actually START about as often as its cron says it
 *       should in the last 24h (`runsPer24h`)? This replaces the old
 *       `net._http_response` / `job_http_failures` probe: pg_net is gone on
 *       Cloudflare (cron triggers call the job in-process), so "the cron
 *       fired but the job never ran" is now detected as missing `job_runs`
 *       rows instead of non-2xx HTTP responses.
 *
 * `evaluateJobHealth` is the pure decision function — no I/O, fixtures in,
 * an issue list out. `runJobHealthJob` is the thin wrapper that fetches the
 * two signals, evaluates, and — only when unhealthy — sends one push per id
 * in `OPS_ALERT_USER_IDS` (optional; see `.env.example`). Unconfigured is not an error: it
 * is logged once and the health summary is still recorded on the `job_runs`
 * row, same as every other job.
 *
 * SETUP: scheduled daily by the `15 6 * * *` Workers cron (`scheduled.ts`).
 *
 * @module jobs/jobHealthJob
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  type JobRunCount,
  JobRunRepository,
  type JobStatusCount,
  type LatestJobRun,
} from '../domains/job/repositories/jobRunRepository';
import { notifyUser } from '../domains/notification';
import type { PushPayload } from '../domains/notification/types';
import { logger } from '../middlewares/logger';

const HOUR_MS = 60 * 60 * 1000;

export interface RegisteredJobHealthDef {
  jobName: string;
  /** Expected cadence's max acceptable gap since the last SUCCESS. */
  maxGapMs: number;
  /** How many times its cron fires in 24h (see `scheduled.ts`). */
  runsPer24h: number;
}

/** Fewer runs than this fraction of `runsPer24h` means ticks are being lost. */
const MIN_RUN_FRACTION = 0.5;

/**
 * The 9 jobs actually registered as Workers cron triggers (`scheduled.ts`). `example-maintenance` is deliberately excluded — it is the SETUP
 * template job, never scheduled in production.
 *
 * Budgets: hourly → 3h, daily → 30h, every 5-10 min → 1h — wide enough that
 * one missed tick (a slow deploy, a brief outage) never pages, tight enough
 * that a genuinely dead job is caught same-day.
 */
export const REGISTERED_JOBS: readonly RegisteredJobHealthDef[] = [
  { jobName: 'schedule-horizon', maxGapMs: 30 * HOUR_MS, runsPer24h: 1 },
  { jobName: 'shift-completion', maxGapMs: 30 * HOUR_MS, runsPer24h: 1 },
  { jobName: 'integrity-checks', maxGapMs: 30 * HOUR_MS, runsPer24h: 1 },
  { jobName: 'reminders', maxGapMs: 3 * HOUR_MS, runsPer24h: 24 },
  {
    jobName: 'cancellation-pay-reconcile',
    maxGapMs: 3 * HOUR_MS,
    runsPer24h: 24,
  },
  { jobName: 'uncovered-digest', maxGapMs: 3 * HOUR_MS, runsPer24h: 24 },
  { jobName: 'no-show-digest', maxGapMs: 3 * HOUR_MS, runsPer24h: 24 },
  { jobName: 'no-show-sweep', maxGapMs: 1 * HOUR_MS, runsPer24h: 144 },
  { jobName: 'cover-ask-expiry', maxGapMs: 1 * HOUR_MS, runsPer24h: 288 },
];

/** Wide enough to still see a daily job's last success from its longest budget. */
const LOOKBACK_MS = 35 * HOUR_MS;
/** (ii) — failed/partial runs in the last 24h. */
const RECENT_FAILURE_WINDOW_MS = 24 * HOUR_MS;

export interface JobHealthIssue {
  jobName: string;
  kind: 'stale_or_missing' | 'failed_or_partial' | 'missed_runs';
  detail: string;
}

export interface EvaluateJobHealthArgs {
  now: Date;
  latestSuccess: readonly LatestJobRun[];
  recentFailures: readonly JobStatusCount[];
  /** Runs of any status started in the last 24h, per job. */
  runCounts: readonly JobRunCount[];
}

export interface JobHealthEvaluation {
  healthy: boolean;
  issues: JobHealthIssue[];
}

/**
 * Pure. (i) flags any registered job whose latest success is missing or
 * older than its own budget; (ii) flags any failed/partial `job_runs` row in
 * the last 24h even for a job that also succeeded since; (iii) flags any
 * job that started far fewer runs in the last 24h than its cron implies.
 */
export function evaluateJobHealth(
  args: EvaluateJobHealthArgs
): JobHealthEvaluation {
  const { now, latestSuccess, recentFailures, runCounts } = args;
  const issues: JobHealthIssue[] = [];

  const latestByJob = new Map(latestSuccess.map(row => [row.job_name, row]));
  for (const def of REGISTERED_JOBS) {
    const latest = latestByJob.get(def.jobName);
    if (!latest) {
      issues.push({
        jobName: def.jobName,
        kind: 'stale_or_missing',
        detail: 'no successful run found in the lookback window',
      });
      continue;
    }
    const gapMs = now.getTime() - new Date(latest.started_at).getTime();
    if (gapMs > def.maxGapMs) {
      issues.push({
        jobName: def.jobName,
        kind: 'stale_or_missing',
        detail: `latest success ${(gapMs / HOUR_MS).toFixed(1)}h ago, exceeds its ${(def.maxGapMs / HOUR_MS).toFixed(1)}h budget`,
      });
    }
  }

  for (const row of recentFailures) {
    issues.push({
      jobName: row.job_name,
      kind: 'failed_or_partial',
      detail: `${row.count} ${row.status} run(s) in the last 24h`,
    });
  }

  const runsByJob = new Map(runCounts.map(row => [row.job_name, row.count]));
  for (const def of REGISTERED_JOBS) {
    const actual = runsByJob.get(def.jobName) ?? 0;
    const floor = Math.floor(def.runsPer24h * MIN_RUN_FRACTION);
    // A job with no rows at all is already reported as stale_or_missing above.
    if (actual > 0 && actual < floor) {
      issues.push({
        jobName: def.jobName,
        kind: 'missed_runs',
        detail: `${actual} run(s) in the last 24h, expected about ${def.runsPer24h}`,
      });
    }
  }

  return { healthy: issues.length === 0, issues };
}

export interface JobHealthJobResult {
  healthy: boolean;
  issueCount: number;
  errorCount: number;
  issues: JobHealthIssue[];
  /** Whether a push actually went out (false if unconfigured). */
  alerted: boolean;
  message: string;
}

/** The narrow repository contract this job depends on, for injecting a fake in tests. */
export type JobHealthRunRepository = Pick<
  JobRunRepository,
  'latestPerJob' | 'countByStatusSince' | 'countRunsSince'
>;

export interface JobHealthJobDeps {
  jobRuns?: JobHealthRunRepository;
  notify?: typeof notifyUser;
  clock?: { now: () => Date };
}

function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function buildAlertPushPayload(issues: readonly JobHealthIssue[]): PushPayload {
  return {
    title: 'Job health alert',
    body: `${issues.length} scheduled job issue(s) need attention.`,
    data: {
      type: PUSH_NOTIFICATION_TYPES.OPS_JOB_HEALTH,
      issueCount: issues.length,
    },
  };
}

/**
 * Sends the alert once the run is known to be unhealthy. Returns whether
 * anything actually went out — `false` when OPS_ALERT_USER_IDS is unset,
 * which is a configuration gap, not a job failure (still logged as a
 * warning by the caller).
 */
async function sendAlerts(
  issues: readonly JobHealthIssue[],
  deps: JobHealthJobDeps
): Promise<boolean> {
  const notify = deps.notify ?? notifyUser;
  const userIds = parseCsvEnv(process.env.OPS_ALERT_USER_IDS);
  const payload = buildAlertPushPayload(issues);
  for (const userId of userIds) {
    notify(userId, payload);
  }
  return userIds.length > 0;
}

export async function runJobHealthJob(
  deps: JobHealthJobDeps = {}
): Promise<JobHealthJobResult> {
  const jobRuns = deps.jobRuns ?? new JobRunRepository();
  const now = (deps.clock ?? { now: () => new Date() }).now();

  if (parseCsvEnv(process.env.OPS_ALERT_USER_IDS).length === 0) {
    logger.warn(
      'Job health: OPS_ALERT_USER_IDS is not configured — issues will be recorded but nobody will be alerted'
    );
  }

  const sinceLatest = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const sinceFailures = new Date(
    now.getTime() - RECENT_FAILURE_WINDOW_MS
  ).toISOString();

  let latestSuccess: LatestJobRun[] = [];
  let recentFailures: JobStatusCount[] = [];
  let runCounts: JobRunCount[] = [];
  let errorCount = 0;

  try {
    latestSuccess = await jobRuns.latestPerJob(sinceLatest);
  } catch (error) {
    errorCount++;
    logger.error('Job health: failed to load latest job runs', { error });
  }

  try {
    recentFailures = await jobRuns.countByStatusSince(sinceFailures);
  } catch (error) {
    errorCount++;
    logger.error('Job health: failed to count recent failed/partial runs', {
      error,
    });
  }

  try {
    runCounts = await jobRuns.countRunsSince(sinceFailures);
  } catch (error) {
    errorCount++;
    logger.error('Job health: failed to count recent runs', {
      error,
    });
  }

  const evaluation = evaluateJobHealth({
    now,
    latestSuccess,
    recentFailures,
    runCounts,
  });

  let alerted = false;
  if (!evaluation.healthy) {
    alerted = await sendAlerts(evaluation.issues, deps);
  }

  return {
    healthy: evaluation.healthy,
    issueCount: evaluation.issues.length,
    errorCount,
    issues: evaluation.issues,
    alerted,
    message: evaluation.healthy
      ? 'All registered jobs healthy'
      : `${evaluation.issues.length} job-health issue(s) detected`,
  };
}
