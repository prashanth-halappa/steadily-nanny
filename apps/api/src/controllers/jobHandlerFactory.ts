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
      runId = await JobRunService.start(jobName);
      logger.info('Job started', { job: jobName, runId });

      const result = await jobFn();

      const jobRunSummary = options?.mapForJobRun
        ? options.mapForJobRun(result)
        : result;
      await JobRunService.complete(runId, jobRunSummary);

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
