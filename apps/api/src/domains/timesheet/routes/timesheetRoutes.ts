/**
 * Flat, id-scoped timesheet action routes — routing + middleware wiring
 * only. Mounted at `/api/v1/timesheets` in `routes/index.ts`.
 *
 * @module domains/timesheet/routes/timesheetRoutes
 */
import { Router } from 'express';
import { authWithOwnership } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TimesheetController } from '../controllers/timesheetController';
import {
  QueryTimesheetSchema,
  ReopenTimesheetSchema,
  TimesheetIdParamSchema,
} from '../schemas';
import { timesheetQueryService } from '../services/timesheetQueryService';
import type { Timesheet } from '../types';

const router = Router();

// Shared ownership guard for /:id routes. The lookup throws
// TimesheetNotFoundError (-> 404) for both "missing" and "not a member" —
// see timesheetQueryService.getOwnedTimesheet. Role (parent-only) is
// enforced in timesheetCommandService.
const timesheetOwnership = {
  param: 'id',
  lookup: (userId: string, timesheetId: string): Promise<Timesheet> =>
    timesheetQueryService.getOwnedTimesheet(userId, timesheetId),
};

// The week read. Same ownership guard as the actions below — any active
// member may READ a week's earnings (a nanny must be able to see what she is
// owed); only a parent may approve, query, or reopen it.
router.get(
  '/:id',
  ...authWithOwnership(TimesheetIdParamSchema, timesheetOwnership),
  asyncHandler(TimesheetController.getWeek)
);

router.post(
  '/:id/approve',
  ...authWithOwnership(TimesheetIdParamSchema, timesheetOwnership),
  asyncHandler(TimesheetController.approve)
);

router.post(
  '/:id/query',
  ...authWithOwnership(TimesheetIdParamSchema, timesheetOwnership),
  validate(QueryTimesheetSchema, 'body'),
  asyncHandler(TimesheetController.query)
);

router.post(
  '/:id/reopen',
  ...authWithOwnership(TimesheetIdParamSchema, timesheetOwnership),
  validate(ReopenTimesheetSchema, 'body'),
  asyncHandler(TimesheetController.reopen)
);

export default router;
