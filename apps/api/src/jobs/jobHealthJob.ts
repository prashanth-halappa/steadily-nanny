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
 * TWO independent signals, both read-only:
 *  (i)  `job_runs` — is each of the 9 registered jobs' latest SUCCESS recent
 *       enough for its own cadence, and did any job fail/partial in the last
 *       24h (`JobRunRepository`, extended for this job).
 *  (ii) `net._http_response` — did pg_net itself see a non-2xx or missing
 *       response in the last 24h, via `public.job_http_failures` (105).
 *
 * `evaluateJobHealth` is the pure decision function — no I/O, fixtures in,
 * an issue list out. `runJobHealthJob` is the thin wrapper that fetches the
 * two signals, evaluates, and — only when unhealthy — sends ONE email to
 * `OPS_ALERT_EMAILS` and one push per id in `OPS_ALERT_USER_IDS` (both new,
 * optional env vars; see `.env.example`). Unconfigured is not an error: it
 * is logged once and the health summary is still recorded on the `job_runs`
 * row, same as every other job.
 *
 * SETUP: scheduled daily via pg_cron in migration `105_job_health_cron.sql`
 * (POST `/api/jobs/job-health`), same Vault-secret prerequisites as every
 * other job cron.
 *
 * @module jobs/jobHealthJob
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { supabaseService } from '../config/supabase';
import { EmailService } from '../domains/email/services/emailService';
import {
  JobRunRepository,
  type JobStatusCount,
  type LatestJobRun,
} from '../domains/job/repositories/jobRunRepository';
import { notifyUser } from '../domains/notification';
import type { PushPayload } from '../domains/notification/types';
import { DatabaseError } from '../errors';
import { logger } from '../middlewares/logger';

const HOUR_MS = 60 * 60 * 1000;

export interface RegisteredJobHealthDef {
  jobName: string;
  /** Expected cadence's max acceptable gap since the last SUCCESS. */
  maxGapMs: number;
}

/**
 * The 9 jobs actually registered as pg_cron entries as of this audit (S2's
 * FACTS). `example-maintenance` is deliberately excluded — it is the SETUP
 * template job, never scheduled in production.
 *
 * Budgets: hourly → 3h, daily → 30h, every 5-10 min → 1h — wide enough that
 * one missed tick (a slow deploy, a brief outage) never pages, tight enough
 * that a genuinely dead job is caught same-day.
 */
export const REGISTERED_JOBS: readonly RegisteredJobHealthDef[] = [
  { jobName: 'schedule-horizon', maxGapMs: 30 * HOUR_MS },
  { jobName: 'shift-completion', maxGapMs: 30 * HOUR_MS },
  { jobName: 'integrity-checks', maxGapMs: 30 * HOUR_MS },
  { jobName: 'reminders', maxGapMs: 3 * HOUR_MS },
  { jobName: 'cancellation-pay-reconcile', maxGapMs: 3 * HOUR_MS },
  { jobName: 'uncovered-digest', maxGapMs: 3 * HOUR_MS },
  { jobName: 'no-show-digest', maxGapMs: 3 * HOUR_MS },
  { jobName: 'no-show-sweep', maxGapMs: 1 * HOUR_MS },
  { jobName: 'cover-ask-expiry', maxGapMs: 1 * HOUR_MS },
];

/** Wide enough to still see a daily job's last success from its longest budget. */
const LOOKBACK_MS = 35 * HOUR_MS;
/** (ii) — failed/partial runs in the last 24h. */
const RECENT_FAILURE_WINDOW_MS = 24 * HOUR_MS;
/** Matches the recent-failure window — same "last 24h" the check answers for. */
const HTTP_FAILURE_LOOKBACK_INTERVAL = '24 hours';

export interface JobHealthIssue {
  jobName: string;
  kind: 'stale_or_missing' | 'failed_or_partial';
  detail: string;
}

export interface JobHttpFailure {
  statusCode: number | null;
  count: number;
}

export interface EvaluateJobHealthArgs {
  now: Date;
  latestSuccess: readonly LatestJobRun[];
  recentFailures: readonly JobStatusCount[];
  httpFailures: readonly JobHttpFailure[];
}

export interface JobHealthEvaluation {
  healthy: boolean;
  issues: JobHealthIssue[];
}

/**
 * Pure. (i) flags any registered job whose latest success is missing or
 * older than its own budget; (ii) flags any failed/partial `job_runs` row in
 * the last 24h even for a job that also succeeded since; (iii) flags any
 * non-zero pg_net failure count pg_cron's own enqueue history can't see.
 */
export function evaluateJobHealth(
  args: EvaluateJobHealthArgs
): JobHealthEvaluation {
  const { now, latestSuccess, recentFailures, httpFailures } = args;
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

  for (const failure of httpFailures) {
    if (failure.count > 0) {
      issues.push({
        jobName: 'pg_net',
        kind: 'failed_or_partial',
        detail: `${failure.count} net._http_response row(s) with status ${failure.statusCode ?? 'null (no response)'} in the last 24h`,
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
  /** Whether an email or push actually went out (false if unconfigured). */
  alerted: boolean;
  message: string;
}

/** The narrow repository contract this job depends on, for injecting a fake in tests. */
export type JobHealthRunRepository = Pick<
  JobRunRepository,
  'latestPerJob' | 'countByStatusSince'
>;

export interface JobHealthJobDeps {
  jobRuns?: JobHealthRunRepository;
  httpFailures?: () => Promise<JobHttpFailure[]>;
  sendEmail?: typeof EmailService.sendEmail;
  notify?: typeof notifyUser;
  clock?: { now: () => Date };
}

function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

async function defaultFetchHttpFailures(): Promise<JobHttpFailure[]> {
  const { data, error } = await supabaseService.rpc('job_http_failures', {
    p_since: HTTP_FAILURE_LOOKBACK_INTERVAL,
  });
  if (error) {
    throw new DatabaseError(
      'Failed to read pg_net failure counts',
      'DATABASE_ERROR',
      { error: error.message }
    );
  }
  return (data ?? []) as JobHttpFailure[];
}

function buildAlertHtml(issues: readonly JobHealthIssue[]): string {
  const rows = issues
    .map(
      issue =>
        `<li><strong>${issue.jobName}</strong> (${issue.kind}): ${issue.detail}</li>`
    )
    .join('');
  return `<p>${issues.length} job-health issue(s) detected:</p><ul>${rows}</ul>`;
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
 * anything actually went out — `false` when neither env var is configured,
 * which is a configuration gap, not a job failure (still logged as a
 * warning by the caller).
 */
async function sendAlerts(
  issues: readonly JobHealthIssue[],
  deps: JobHealthJobDeps
): Promise<boolean> {
  const sendEmail = deps.sendEmail ?? EmailService.sendEmail;
  const notify = deps.notify ?? notifyUser;
  const emails = parseCsvEnv(process.env.OPS_ALERT_EMAILS);
  const userIds = parseCsvEnv(process.env.OPS_ALERT_USER_IDS);

  if (emails.length === 0 && userIds.length === 0) {
    return false;
  }

  const subject = `Steadily job health: ${issues.length} issue(s)`;
  const html = buildAlertHtml(issues);
  let alerted = false;

  for (const email of emails) {
    try {
      const result = await sendEmail({
        to: email,
        emailType: 'ops_job_health',
        subject,
        html,
      });
      alerted = alerted || result.sent;
    } catch (error) {
      logger.error('Job health: alert email failed', { email, error });
    }
  }

  const payload = buildAlertPushPayload(issues);
  for (const userId of userIds) {
    notify(userId, payload);
    alerted = true;
  }

  return alerted;
}

export async function runJobHealthJob(
  deps: JobHealthJobDeps = {}
): Promise<JobHealthJobResult> {
  const jobRuns = deps.jobRuns ?? new JobRunRepository();
  const fetchHttpFailures = deps.httpFailures ?? defaultFetchHttpFailures;
  const now = (deps.clock ?? { now: () => new Date() }).now();

  if (
    parseCsvEnv(process.env.OPS_ALERT_EMAILS).length === 0 &&
    parseCsvEnv(process.env.OPS_ALERT_USER_IDS).length === 0
  ) {
    logger.warn(
      'Job health: neither OPS_ALERT_EMAILS nor OPS_ALERT_USER_IDS is configured — issues will be recorded but nobody will be alerted'
    );
  }

  const sinceLatest = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const sinceFailures = new Date(
    now.getTime() - RECENT_FAILURE_WINDOW_MS
  ).toISOString();

  let latestSuccess: LatestJobRun[] = [];
  let recentFailures: JobStatusCount[] = [];
  let httpFailures: JobHttpFailure[] = [];
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
    httpFailures = await fetchHttpFailures();
  } catch (error) {
    errorCount++;
    logger.error('Job health: failed to read pg_net failure counts', {
      error,
    });
  }

  const evaluation = evaluateJobHealth({
    now,
    latestSuccess,
    recentFailures,
    httpFailures,
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
