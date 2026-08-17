/**
 * @module tests/unit/jobs/jobHealthJob.test
 * J1-b — the job-health job. S2 found that cron "success" only proves pg_net
 * enqueued the call, `net._http_response` has zero readers, and five of
 * scheduleHorizonJob's sweeps used to swallow their own errors (fixed by
 * J1-a). This job is the automated surface that was missing entirely.
 *
 * `evaluateJobHealth` is pure — fixtures in, an issue list out — tested
 * directly with no mocking. `runJobHealthJob` is the thin I/O wrapper,
 * tested with every dependency injected.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  evaluateJobHealth,
  REGISTERED_JOBS,
} from '../../../src/jobs/jobHealthJob';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-08-17T12:00:00.000Z');

describe('evaluateJobHealth — the static job table', () => {
  it('covers exactly the 9 jobs that actually run in production, per the audit', () => {
    const names = REGISTERED_JOBS.map(j => j.jobName).sort();
    expect(names).toEqual(
      [
        'cancellation-pay-reconcile',
        'cover-ask-expiry',
        'integrity-checks',
        'no-show-digest',
        'no-show-sweep',
        'reminders',
        'schedule-horizon',
        'shift-completion',
        'uncovered-digest',
      ].sort()
    );
  });
});

describe('evaluateJobHealth', () => {
  function allHealthy() {
    return REGISTERED_JOBS.map(def => ({
      job_name: def.jobName,
      status: 'success' as const,
      started_at: new Date(NOW.getTime() - HOUR_MS).toISOString(),
    }));
  }

  it('reports healthy when every job has a recent success and nothing failed', () => {
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: allHealthy(),
      recentFailures: [],
      httpFailures: [],
    });

    expect(result.healthy).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a job with no successful run at all (missing)', () => {
    const withoutOne = allHealthy().filter(
      r => r.job_name !== 'schedule-horizon'
    );
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: withoutOne,
      recentFailures: [],
      httpFailures: [],
    });

    expect(result.healthy).toBe(false);
    expect(result.issues.some(i => i.jobName === 'schedule-horizon')).toBe(
      true
    );
  });

  it('flags a job whose latest success is older than its expected max gap', () => {
    const rows = allHealthy().map(r =>
      r.job_name === 'reminders'
        ? {
            ...r,
            started_at: new Date(NOW.getTime() - 10 * HOUR_MS).toISOString(),
          }
        : r
    );
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: rows,
      recentFailures: [],
      httpFailures: [],
    });

    expect(result.healthy).toBe(false);
    const issue = result.issues.find(i => i.jobName === 'reminders');
    expect(issue).toBeDefined();
  });

  it('does not flag a daily job whose success is 10h old (well within a 30h budget)', () => {
    const rows = allHealthy().map(r =>
      r.job_name === 'schedule-horizon'
        ? {
            ...r,
            started_at: new Date(NOW.getTime() - 10 * HOUR_MS).toISOString(),
          }
        : r
    );
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: rows,
      recentFailures: [],
      httpFailures: [],
    });

    expect(result.healthy).toBe(true);
  });

  it('flags any job with a failed/partial run in the last 24h even if it also succeeded', () => {
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: allHealthy(),
      recentFailures: [
        { job_name: 'no-show-sweep', status: 'failed', count: 2 },
      ],
      httpFailures: [],
    });

    expect(result.healthy).toBe(false);
    expect(
      result.issues.some(
        i => i.jobName === 'no-show-sweep' && i.kind === 'failed_or_partial'
      )
    ).toBe(true);
  });

  it('flags a non-zero pg_net http failure count', () => {
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: allHealthy(),
      recentFailures: [],
      httpFailures: [{ statusCode: 401, count: 5 }],
    });

    expect(result.healthy).toBe(false);
    expect(result.issues.some(i => i.detail.includes('401'))).toBe(true);
  });

  it('ignores an httpFailures row with count 0', () => {
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: allHealthy(),
      recentFailures: [],
      httpFailures: [{ statusCode: 200, count: 0 }],
    });

    expect(result.healthy).toBe(true);
  });
});

let runJobHealthJob: typeof import('../../../src/jobs/jobHealthJob').runJobHealthJob;
let EmailService: { sendEmail: ReturnType<typeof mock> };

beforeAll(async () => {
  mock.module('../../../src/domains/email/services/emailService', () => ({
    EmailService: { sendEmail: mock(async () => ({ sent: true })) },
  }));
  const mod = await import('../../../src/jobs/jobHealthJob');
  runJobHealthJob = mod.runJobHealthJob;
  EmailService = (
    await import('../../../src/domains/email/services/emailService')
  ).EmailService as unknown as { sendEmail: ReturnType<typeof mock> };
});

beforeEach(() => {
  EmailService.sendEmail.mockClear?.();
  process.env.OPS_ALERT_EMAILS = undefined;
  process.env.OPS_ALERT_USER_IDS = undefined;
});

function healthyFixtures(now: Date) {
  return REGISTERED_JOBS.map(def => ({
    job_name: def.jobName,
    status: 'success' as const,
    started_at: new Date(now.getTime() - HOUR_MS).toISOString(),
  }));
}

describe('runJobHealthJob — I/O wrapper', () => {
  it('records a healthy summary and sends nothing when nothing is wrong', async () => {
    const jobRuns = {
      latestPerJob: mock(async () => healthyFixtures(NOW)),
      countByStatusSince: mock(async () => []),
    };
    const result = await runJobHealthJob({
      jobRuns,
      httpFailures: async () => [],
      clock: { now: () => NOW },
    });

    expect(result.healthy).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(EmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('sends one alert email per configured OPS_ALERT_EMAILS address when unhealthy', async () => {
    process.env.OPS_ALERT_EMAILS = 'ops1@steadily.app, ops2@steadily.app';
    const jobRuns = {
      latestPerJob: mock(async () => []),
      countByStatusSince: mock(async () => []),
    };
    const result = await runJobHealthJob({
      jobRuns,
      httpFailures: async () => [],
      clock: { now: () => NOW },
    });

    expect(result.healthy).toBe(false);
    expect(EmailService.sendEmail).toHaveBeenCalledTimes(2);
    expect(result.alerted).toBe(true);
  });

  it('pushes to every configured OPS_ALERT_USER_IDS id when unhealthy', async () => {
    process.env.OPS_ALERT_USER_IDS = 'user-1, user-2';
    const notify = mock(() => undefined);
    const jobRuns = {
      latestPerJob: mock(async () => []),
      countByStatusSince: mock(async () => []),
    };
    const result = await runJobHealthJob({
      jobRuns,
      httpFailures: async () => [],
      clock: { now: () => NOW },
      notify,
    });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(result.alerted).toBe(true);
  });

  it('logs a warning and records the summary without sending when unconfigured', async () => {
    const jobRuns = {
      latestPerJob: mock(async () => []),
      countByStatusSince: mock(async () => []),
    };
    const result = await runJobHealthJob({
      jobRuns,
      httpFailures: async () => [],
      clock: { now: () => NOW },
    });

    expect(result.healthy).toBe(false);
    expect(result.alerted).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(EmailService.sendEmail).not.toHaveBeenCalled();
  });

  it('counts a failed dependency query into errorCount rather than throwing', async () => {
    const jobRuns = {
      latestPerJob: mock(async () => {
        throw new Error('job_runs unreachable');
      }),
      countByStatusSince: mock(async () => []),
    };
    const result = await runJobHealthJob({
      jobRuns,
      httpFailures: async () => [],
      clock: { now: () => NOW },
    });

    expect(result.errorCount).toBeGreaterThan(0);
  });
});
