/**
 * Integrity-check job — turns 056's `run_integrity_checks()` rows into
 * error-level logs and a failed job run.
 *
 * The job is only half of the mechanism. The other half is
 * `createTrackedJobHandler` failing loudly on `errorCount > 0` (F-B9-9): a
 * sweep that finds eight corrupted timesheets and then returns 200 with a
 * success envelope is worth nothing. The last describe block proves the two
 * halves compose.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextFunction, Request } from 'express';

let runIntegrityCheckJob: typeof import('../../../src/jobs/integrityCheckJob').runIntegrityCheckJob;
let createTrackedJobHandler: typeof import('../../../src/controllers/jobHandlerFactory').createTrackedJobHandler;
let JobRunService: any;
let logger: any;

beforeAll(async () => {
  mock.module('../../../src/middlewares/logger', () => ({
    logger: {
      info: mock(() => undefined),
      error: mock(() => undefined),
      warn: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));
  mock.module('../../../src/domains/job/services/jobRunService', () => ({
    JobRunService: {
      // No fresh in-flight run — the F-B4-10 guard must let the job proceed.
      hasFreshRunningRun: mock(async () => false),
      start: mock(async () => 'run-1'),
      complete: mock(async () => undefined),
      fail: mock(async () => undefined),
    },
  }));
  mock.module('../../../src/config/sentry', () => ({
    default: { captureException: mock(() => undefined) },
  }));

  runIntegrityCheckJob = (await import('../../../src/jobs/integrityCheckJob'))
    .runIntegrityCheckJob;
  createTrackedJobHandler = (
    await import('../../../src/controllers/jobHandlerFactory')
  ).createTrackedJobHandler;
  JobRunService = (
    await import('../../../src/domains/job/services/jobRunService')
  ).JobRunService;
  logger = (await import('../../../src/middlewares/logger')).logger;
});

beforeEach(() => {
  logger.error.mockClear?.();
  JobRunService.start.mockClear?.();
  JobRunService.complete.mockClear?.();
  JobRunService.fail.mockClear?.();
});

const violation = (checkName: string, entityId: string) => ({
  check_name: checkName,
  entity_id: entityId,
  details: { household_id: 'h1' },
});

/** A fake in the shape of `supabaseService.rpc`'s resolved value. */
const rpcReturning = (rows: unknown[]) =>
  mock(async () => ({
    data: rows,
    error: null,
  }));

describe('runIntegrityCheckJob', () => {
  it('reports a clean database as a clean run and logs no errors', async () => {
    const result = await runIntegrityCheckJob(rpcReturning([]));

    expect(result.errorCount).toBe(0);
    expect(result.violations).toEqual({});
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('counts every violation and logs once per class, not once per row', async () => {
    // One log per row would bury a five-row class in a hundred-row one and
    // make the alert unreadable; the class IS the actionable unit.
    const result = await runIntegrityCheckJob(
      rpcReturning([
        violation('timesheet_total_mismatch', 'ts-1'),
        violation('timesheet_total_mismatch', 'ts-2'),
        violation('stuck_runner', 'te-9'),
      ])
    );

    expect(result.errorCount).toBe(3);
    expect(result.violations).toEqual({
      timesheet_total_mismatch: 2,
      stuck_runner: 1,
    });
    expect(logger.error).toHaveBeenCalledTimes(2);

    const logged = logger.error.mock.calls.map((call: unknown[]) => call[1]);
    expect(logged).toContainEqual(
      expect.objectContaining({
        check: 'timesheet_total_mismatch',
        count: 2,
        sampleIds: ['ts-1', 'ts-2'],
      })
    );
  });

  it('samples at most five ids so one bad migration cannot flood the logs', async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      violation('entry_overlap', `te-${index}`)
    );

    const result = await runIntegrityCheckJob(rpcReturning(rows));

    expect(result.errorCount).toBe(12);
    expect(logger.error.mock.calls[0][1].count).toBe(12);
    expect(logger.error.mock.calls[0][1].sampleIds).toEqual([
      'te-0',
      'te-1',
      'te-2',
      'te-3',
      'te-4',
    ]);
  });

  it('throws when the rpc itself fails', async () => {
    // A sweep that cannot run is NOT a clean database. Returning errorCount 0
    // here would report "no violations" for a function that never executed —
    // the failure mode that makes monitoring actively misleading.
    const failingRpc = mock(async () => ({
      data: null,
      error: { message: 'function run_integrity_checks() does not exist' },
    }));

    await expect(runIntegrityCheckJob(failingRpc)).rejects.toThrow();
  });
});

describe('integrity job + tracked handler (composed)', () => {
  it('violations produce a failed run, an error log and a non-success response', async () => {
    const handler = createTrackedJobHandler(
      'integrity-checks',
      () =>
        runIntegrityCheckJob(
          rpcReturning([
            violation('cancellation_unsettled', 'shift-1'),
            violation('orphan_week', 'te-1'),
          ])
        ),
      'Integrity checks completed'
    );

    const res: any = { locals: { requestId: 'req-1' } };
    res.status = () => res;
    res.json = (body: unknown) => {
      res.body = body;
      return res;
    };
    let forwarded: unknown;
    await handler({} as Request, res, ((e?: unknown) => {
      forwarded = e;
    }) as NextFunction);

    // The run row records the failure: two violations, no successes, which
    // JobRunService derives as status 'failed'.
    expect(JobRunService.complete).toHaveBeenCalledTimes(1);
    expect(JobRunService.complete.mock.calls[0][1]).toMatchObject({
      errorCount: 2,
    });

    // Two per-class logs plus the handler's own "completed with errors".
    expect(logger.error).toHaveBeenCalledTimes(3);

    expect(res.body).toBeUndefined();
    expect(forwarded).toBeInstanceOf(Error);
  });
});
