/**
 * @module tests/unit/jobs/jobHealthJob.test
 * J1-b — the job-health job. S2 found that cron "success" only proves the
 * trigger fired, not that the job ran, and five of
 * scheduleHorizonJob's sweeps used to swallow their own errors (fixed by
 * J1-a). This job is the automated surface that was missing entirely.
 *
 * `evaluateJobHealth` is pure — fixtures in, an issue list out — tested
 * directly with no mocking. `runJobHealthJob` is the thin I/O wrapper,
 * tested with every dependency injected.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const { evaluateJobHealth, REGISTERED_JOBS } = await import(
  '../../../src/jobs/jobHealthJob'
);

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
      runCounts: [],
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
      runCounts: [],
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
      runCounts: [],
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
      runCounts: [],
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
      runCounts: [],
    });

    expect(result.healthy).toBe(false);
    expect(
      result.issues.some(
        i => i.jobName === 'no-show-sweep' && i.kind === 'failed_or_partial'
      )
    ).toBe(true);
  });

  it('flags a job that started far fewer runs than its cron implies', () => {
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: allHealthy(),
      recentFailures: [],
      // reminders fires hourly (24/day); 5 rows means ticks are being lost.
      runCounts: [{ job_name: 'reminders', count: 5 }],
    });

    expect(result.healthy).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ jobName: 'reminders', kind: 'missed_runs' }),
    ]);
  });

  it('accepts a job whose run count is near its cadence, and jobs with no rows', () => {
    const result = evaluateJobHealth({
      now: NOW,
      latestSuccess: allHealthy(),
      recentFailures: [],
      runCounts: [{ job_name: 'reminders', count: 23 }],
    });

    expect(result.healthy).toBe(true);
  });
});

let runJobHealthJob: typeof import('../../../src/jobs/jobHealthJob').runJobHealthJob;

beforeAll(async () => {
  const mod = await import('../../../src/jobs/jobHealthJob');
  runJobHealthJob = mod.runJobHealthJob;
});

beforeEach(() => {
  delete process.env.OPS_ALERT_USER_IDS;
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
      countRunsSince: mock(async () => []),
    };
    process.env.OPS_ALERT_USER_IDS = 'user-1';
    const notify = mock(() => undefined);
    const result = await runJobHealthJob({
      jobRuns,
      clock: { now: () => NOW },
      notify,
    });

    expect(result.healthy).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('pushes to every configured OPS_ALERT_USER_IDS id when unhealthy', async () => {
    process.env.OPS_ALERT_USER_IDS = 'user-1, user-2';
    const notify = mock(() => undefined);
    const jobRuns = {
      latestPerJob: mock(async () => []),
      countByStatusSince: mock(async () => []),
      countRunsSince: mock(async () => []),
    };
    const result = await runJobHealthJob({
      jobRuns,
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
      countRunsSince: mock(async () => []),
    };
    const notify = mock(() => undefined);
    const result = await runJobHealthJob({
      jobRuns,
      clock: { now: () => NOW },
      notify,
    });

    expect(result.healthy).toBe(false);
    expect(result.alerted).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('counts a failed dependency query into errorCount rather than throwing', async () => {
    const jobRuns = {
      latestPerJob: mock(async () => {
        throw new Error('job_runs unreachable');
      }),
      countByStatusSince: mock(async () => []),
      countRunsSince: mock(async () => []),
    };
    const result = await runJobHealthJob({
      jobRuns,
      clock: { now: () => NOW },
    });

    expect(result.errorCount).toBeGreaterThan(0);
  });
});
