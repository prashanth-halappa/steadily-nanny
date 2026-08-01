/**
 * Job controller.
 *
 * HTTP handlers for scheduled-job endpoints, built with the job handler
 * factories. Add one line per job.
 *
 * @module controllers/jobController
 */
import { runExampleMaintenanceJob } from '../jobs/exampleMaintenanceJob';
import { createTrackedJobHandler } from './jobHandlerFactory';

export const JobController = {
  /** POST /api/jobs/example-maintenance */
  runExampleMaintenance: createTrackedJobHandler(
    'example-maintenance',
    runExampleMaintenanceJob,
    'Example maintenance job completed'
  ),
};
