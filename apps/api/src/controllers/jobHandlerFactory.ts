/**
 * Job handler factories.
 *
 * Extracted from the source's monolithic jobController so any job route can be
 * wired with one line. Two flavors:
 * - `createTrackedJobHandler` — records a job_runs row via JobRunService
 *   (start → execute → complete/fail), with logging + Sentry.
 * - `createSimpleJobHandler` — just logs, runs, and responds (no run tracking).
 *
 * @module controllers/jobHandlerFactory
 */
import type { NextFunction, Request, Response } from 'express';
import Sentry from '../config/sentry';
import { JobRunService } from '../domains/job/services/jobRunService';
import { BaseError } from '../errors';
import { logger } from '../middlewares/logger';
import { sendSuccessResponse } from '../utils/responseHelpers';

export type JobHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;

// biome-ignore lint/suspicious/noExplicitAny: factory accepts any job result shape
type AnyResult = Record<string, any>;

/**
 * A job that ran to completion but reported failures.
 *
 * The distinction from a thrown job error is only about where the failure was
 * detected, not how bad it is: a run that processed 500 rows and failed 12 of
 * them is not a success, and returning 200 for it (which is what this class
 * exists to stop) meant nobody ever found out — the count lived in a
 * `job_runs` row no human reads.
 */
export class JobCompletedWithErrorsError extends BaseError {
  constructor(jobName: string, errorCount: number, runId: string | null) {
    super(
      `Job ${jobName} completed with ${errorCount} error(s)`,
      'INTERNAL_ERROR',
      500,
      true,
      { job: jobName, errorCount, runId }
    );
  }
}

/**
 * A second invocation landed while this job was still running (pg_net retry,
 * manual POST overlapping a slow run). Refused before touching job_runs at
 * all — cheap, not perfect: see the in-flight guard comment below.
 */
export class JobAlreadyRunningError extends BaseError {
  constructor(jobName: string) {
    super(`Job ${jobName} is already running`, 'CONFLICT', 409, true, {
      job: jobName,
    });
  }
}

/**
 * Handler that tracks the run lifecycle via JobRunService.
 */
export function createTrackedJobHandler<T extends AnyResult>(
  jobName: string,
  jobFn: () => Promise<T>,
  successMessage: string,
  options?: {
    /** Map job result to the JobRunService.complete() summary. */
    mapForJobRun?: (result: T) => AnyResult;
    /** Map job result to the response payload (defaults to the full result). */
    mapForResponse?: (result: T) => AnyResult;
  }
): JobHandler {
  return async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    let runId: string | null = null;
    try {
      // ponytail: check-then-act, not a DB reservation — two simultaneous
      // POSTs can both pass this read before either inserts a row. The cron
      // cadence here is hourly+, so that window is irrelevant in practice;
      // `JobRunService.startWithIdempotencyKey` (CAS-guarded reclaim) is the
      // upgrade path if a job ever needs a real reservation.
      if (await JobRunService.hasFreshRunningRun(jobName)) {
        next(new JobAlreadyRunningError(jobName));
        return;
      }

      runId = await JobRunService.start(jobName);
      logger.info('Job started', { job: jobName, runId });

      const result = await jobFn();

      const jobRunSummary = options?.mapForJobRun
        ? options.mapForJobRun(result)
        : result;
      // Complete FIRST, always: JobRunService derives partial/failed from the
      // summary's errorCount, so the row records the truth even on the loud
      // path below. Bailing before it would leave the run stuck 'running'.
      await JobRunService.complete(runId, jobRunSummary);

      const errorCount = Number(jobRunSummary.errorCount ?? 0);
      if (errorCount > 0) {
        // Error level is the whole point — SentryTransport forwards it, so
        // this is what turns "12 rows failed" into something a human sees.
        logger.error('Job completed with errors', {
          job: jobName,
          runId,
          summary: jobRunSummary,
        });
        next(new JobCompletedWithErrorsError(jobName, errorCount, runId));
        return;
      }

      const responsePayload = options?.mapForResponse
        ? options.mapForResponse(result)
        : result;
      sendSuccessResponse(res, successMessage, {
        job: jobName,
        runId,
        ...responsePayload,
      });
    } catch (error) {
      logger.error('Job failed', { job: jobName, runId, error });
      Sentry.captureException(error, { tags: { job: jobName } });
      if (runId) {
        await JobRunService.fail(runId, error as Error);
      }
      next(error);
    }
  };
}

/**
 * Simple handler without run tracking.
 */
export function createSimpleJobHandler<T extends AnyResult>(
  jobName: string,
  jobFn: () => Promise<T>,
  successMessage: string,
  mapForResponse?: (result: T) => AnyResult
): JobHandler {
  return async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      logger.info(`${jobName} job triggered`, { job: jobName });
      const result = await jobFn();
      const responsePayload = mapForResponse ? mapForResponse(result) : result;
      sendSuccessResponse(res, successMessage, {
        job: jobName,
        ...responsePayload,
      });
    } catch (error) {
      logger.error('Job failed', { job: jobName, error });
      Sentry.captureException(error, { tags: { job: jobName } });
      next(error);
    }
  };
}
