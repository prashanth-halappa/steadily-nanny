/**
 * Example maintenance job.
 *
 * A no-op scheduled job that demonstrates the pattern: it does a trivial unit of
 * work and returns a summary that the tracked-job handler records into the
 * `job_runs` table. The example pg_cron schedule (migration 007) invokes this at
 * POST /api/jobs/example-maintenance.
 *
 * SETUP: replace this with your real scheduled work (batch processing, digests,
 * cleanup, etc.). See docs for the batch-job design notes.
 *
 * @module jobs/exampleMaintenanceJob
 */
import { logger } from '../middlewares/logger';

export interface ExampleMaintenanceResult {
  successCount: number;
  errorCount: number;
  message: string;
}

export async function runExampleMaintenanceJob(): Promise<ExampleMaintenanceResult> {
  // A real job would claim rows (FOR UPDATE SKIP LOCKED), process a small batch,
  // and record success/failure counts. This example just returns a summary.
  logger.info('Example maintenance job ran (no-op)');
  return {
    successCount: 0,
    errorCount: 0,
    message: 'Example maintenance job completed (no-op)',
  };
}
