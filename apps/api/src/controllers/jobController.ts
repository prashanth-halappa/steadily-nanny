/**
 * Job controller.
 *
 * HTTP handlers for scheduled-job endpoints, built with the job handler
 * factories. Add one line per job.
 *
 * @module controllers/jobController
 */
import { runExampleMaintenanceJob } from '../jobs/exampleMaintenanceJob';
import { runScheduleHorizonJob } from '../jobs/scheduleHorizonJob';
import { createTrackedJobHandler } from './jobHandlerFactory';

export const JobController = {
  /** POST /api/jobs/example-maintenance */
  runExampleMaintenance: createTrackedJobHandler(
    'example-maintenance',
    runExampleMaintenanceJob,
    'Example maintenance job completed'
  ),

  /** POST /api/jobs/schedule-horizon */
  runScheduleHorizon: createTrackedJobHandler(
    'schedule-horizon',
    runScheduleHorizonJob,
    'Schedule horizon job completed',
    {
      mapForJobRun: result => ({
        totalProcessed: result.patternsProcessed,
        successCount: result.successCount,
        errorCount: result.errorCount,
      }),
    }
  ),
};
