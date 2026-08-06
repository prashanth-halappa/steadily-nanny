/**
 * Job handler factory contract.
 *
 * The tracked handler's job is not just to run a function — it is the only
 * thing standing between "the job reported N failures" and a human finding
 * out. Until F-B9-9 a job that returned `errorCount: 2` got a 200 and a
 * cheerful success envelope; the failed rows existed only in the `job_runs`
 * row nobody reads. These tests pin the loud path.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
// Type-only: erased at runtime, so it does not load the module before the
// mocks below are registered.
import type { JobHandler } from '../../../src/controllers/jobHandlerFactory';

type FactoryModule =
  typeof import('../../../src/controllers/jobHandlerFactory');

let createSimpleJobHandler: FactoryModule['createSimpleJobHandler'];
let createTrackedJobHandler: FactoryModule['createTrackedJobHandler'];
let JobRunService: any;
let logger: any;

beforeAll(async () => {
  mock.module('../../../src/domains/job/services/jobRunService', () => ({
    JobRunService: {
      start: mock(async () => 'run-1'),
      complete: mock(async () => undefined),
      fail: mock(async () => undefined),
      hasFreshRunningRun: mock(async () => false),
    },
  }));
  mock.module('../../../src/middlewares/logger', () => ({
    logger: {
      info: mock(() => undefined),
      error: mock(() => undefined),
      warn: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));
  mock.module('../../../src/config/sentry', () => ({
    default: { captureException: mock(() => undefined) },
  }));

  const mod = await import('../../../src/controllers/jobHandlerFactory');
  createSimpleJobHandler = mod.createSimpleJobHandler;
  createTrackedJobHandler = mod.createTrackedJobHandler;
  JobRunService = (
    await import('../../../src/domains/job/services/jobRunService')
  ).JobRunService;
  logger = (await import('../../../src/middlewares/logger')).logger;
});

beforeEach(() => {
  JobRunService.start.mockClear?.();
  JobRunService.complete.mockClear?.();
  JobRunService.fail.mockClear?.();
  JobRunService.hasFreshRunningRun.mockClear?.();
  JobRunService.hasFreshRunningRun.mockImplementation(async () => false);
  logger.error.mockClear?.();
});

function fakeRes(): Response & { statusCode?: number; body?: any } {
  const res: any = { locals: { requestId: 'req-1' } };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

/** Run a handler and capture whatever it hands to `next()`. */
async function invoke(handler: JobHandler) {
  const res = fakeRes();
  let error: unknown;
  await handler({} as Request, res, ((e?: unknown) => {
    error = e;
  }) as NextFunction);
  return { res, error };
}

describe('createSimpleJobHandler', () => {
  test('runs the job and responds with a success envelope', async () => {
    const handler = createSimpleJobHandler(
      'example',
      async () => ({ successCount: 1 }),
      'done'
    );
    const { res, error } = await invoke(handler);

    expect(error).toBeUndefined();
    expect(res.body.success).toBe(true);
    expect(res.body.data.job).toBe('example');
    expect(res.body.data.successCount).toBe(1);
  });

  test('forwards a thrown job error to next()', async () => {
    const handler = createSimpleJobHandler(
      'example',
      async () => {
        throw new Error('boom');
      },
      'done'
    );
    const { error } = await invoke(handler);

    expect(error).toBeInstanceOf(Error);
  });
});

describe('createTrackedJobHandler — clean run', () => {
  test('completes the run and responds with a success envelope', async () => {
    const handler = createTrackedJobHandler(
      'clean-job',
      async () => ({ successCount: 5, errorCount: 0 }),
      'done'
    );
    const { res, error } = await invoke(handler);

    expect(error).toBeUndefined();
    expect(res.body.success).toBe(true);
    expect(res.body.data.runId).toBe('run-1');
    expect(JobRunService.complete).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('createTrackedJobHandler — F-B9-9: errorCount > 0 fails loudly', () => {
  test('logs at error level, fails the response, and still completes the run', async () => {
    const handler = createTrackedJobHandler(
      'partial-job',
      async () => ({ successCount: 5, errorCount: 2 }),
      'done'
    );
    const { res, error } = await invoke(handler);

    // The run row must still be completed: JobRunService derives
    // partial/failed from the summary's errorCount, and skipping complete()
    // would leave the row 'running' forever instead of recording the truth.
    expect(JobRunService.complete).toHaveBeenCalledTimes(1);
    expect(JobRunService.complete.mock.calls[0][1]).toMatchObject({
      errorCount: 2,
    });

    // logger.error is what reaches Sentry (SentryTransport forwards level
    // error) — an info log here is indistinguishable from a healthy run.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('errors');
    expect(logger.error.mock.calls[0][1]).toMatchObject({
      job: 'partial-job',
      runId: 'run-1',
    });

    // No success envelope. The caller (pg_cron / a human) must see a failure.
    expect(res.body).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('partial-job');
  });

  test('reads errorCount off the mapped summary, not the raw result', async () => {
    // The reconcile job's raw result carries a zero errorCount while its
    // needsHuman/stillUnpaid counts are the actual unpaid carers; the mapper
    // is what folds them in, so the gate must read the mapped value.
    const handler = createTrackedJobHandler(
      'mapped-job',
      async () => ({ errorCount: 0, needsHumanCount: 3 }),
      'done',
      {
        mapForJobRun: result => ({
          errorCount: result.errorCount + result.needsHumanCount,
        }),
      }
    );
    const { res, error } = await invoke(handler);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(res.body).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
  });

  test('a thrown job still fails the run and forwards the error', async () => {
    const handler = createTrackedJobHandler(
      'throwing-job',
      async () => {
        throw new Error('boom');
      },
      'done'
    );
    const { error } = await invoke(handler);

    expect(JobRunService.fail).toHaveBeenCalledTimes(1);
    expect(JobRunService.complete).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('createTrackedJobHandler — F-B4-10: in-flight guard', () => {
  test('a fresh running row for the same job blocks the run with 409', async () => {
    JobRunService.hasFreshRunningRun.mockImplementation(
      async (jobName: string) => jobName === 'guarded-job'
    );
    const jobFn = mock(async () => ({ successCount: 1, errorCount: 0 }));
    const handler = createTrackedJobHandler('guarded-job', jobFn, 'done');
    const { res, error } = await invoke(handler);

    expect(jobFn).not.toHaveBeenCalled();
    expect(JobRunService.start).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect((error as { statusCode?: number }).statusCode).toBe(409);
    expect((error as { code?: string }).code).toBe('CONFLICT');
    expect((error as Error).message).toContain('guarded-job');
  });

  test('a stale/no running row lets the job run normally', async () => {
    JobRunService.hasFreshRunningRun.mockImplementation(async () => false);
    const jobFn = mock(async () => ({ successCount: 1, errorCount: 0 }));
    const handler = createTrackedJobHandler('unguarded-job', jobFn, 'done');
    const { res, error } = await invoke(handler);

    expect(jobFn).toHaveBeenCalledTimes(1);
    expect(JobRunService.start).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
    expect(res.body.success).toBe(true);
  });

  test('a running row for a different job name does not block this one', async () => {
    JobRunService.hasFreshRunningRun.mockImplementation(
      async (jobName: string) => jobName === 'other-job'
    );
    const jobFn = mock(async () => ({ successCount: 1, errorCount: 0 }));
    const handler = createTrackedJobHandler('this-job', jobFn, 'done');
    const { error } = await invoke(handler);

    expect(jobFn).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
  });
});
