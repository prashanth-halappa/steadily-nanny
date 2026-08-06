/**
 * Scheduled-job routes.
 *
 * Mounted at `/api/jobs` BEFORE the Supabase auth layer (see app.ts). Every
 * route is guarded by `validateJobApiKey` — there is no logged-in user, only the
 * shared X-Job-Api-Key secret. `jobHandler` fire-and-forgets the async handler
 * so the route can ACK quickly.
 *
 * @module routes/jobRoutes
 */
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from 'express';
import { JobController } from '../controllers/jobController';
import { createTrackedJobHandler } from '../controllers/jobHandlerFactory';
import { runCancellationPayReconcileJob } from '../jobs/cancellationPayReconcileJob';
import { validateJobApiKey } from '../middlewares/jobAuth';

// Adapt an async handler into an Express handler that fire-and-forgets.
const jobHandler =
  (
    method: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void method(req, res, next);
  };

const router = Router();

// Every job route requires the API key.
router.use(validateJobApiKey);

// SETUP: add your own job routes here, one line each.
router.post(
  '/example-maintenance',
  jobHandler(JobController.runExampleMaintenance)
);
router.post('/schedule-horizon', jobHandler(JobController.runScheduleHorizon));
router.post('/reminders', jobHandler(JobController.runReminders));
// Built inline rather than in `JobController` only because that file was not
// mine to touch this pass — move it there for consistency when convenient.
router.post(
  '/cancellation-pay-reconcile',
  jobHandler(
    createTrackedJobHandler(
      'cancellation-pay-reconcile',
      runCancellationPayReconcileJob,
      'Cancellation pay reconcile job completed'
    )
  )
);

export default router;
