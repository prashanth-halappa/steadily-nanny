/**
 * Flat, id-scoped time-entry routes — routing + middleware wiring only.
 * Mounted at `/api/v1/time-entries` in `routes/index.ts`.
 *
 * @module domains/timesheet/routes/timeEntryRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import {
  authWithOwnership,
  authWithValidation,
} from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { TimesheetController } from '../controllers/timesheetController';
import {
  ClockInSchema,
  ClockOutSchema,
  CreateRetroactiveTimeEntrySchema,
  TimeEntryIdParamSchema,
  UpdateTimeEntrySchema,
} from '../schemas';
import { timesheetQueryService } from '../services/timesheetQueryService';
import type { TimeEntry } from '../types';

const router = Router();

// Shared ownership guard for /:id routes. The lookup throws
// TimeEntryNotFoundError (-> 404) for both "missing" and "not yours" — see
// timesheetQueryService.getOwnedTimeEntry.
const timeEntryOwnership = {
  param: 'id',
  lookup: (userId: string, timeEntryId: string): Promise<TimeEntry> =>
    timesheetQueryService.getOwnedTimeEntry(userId, timeEntryId),
};

// The caller's own open entry, or null. Registered before /:id so 'running'
// is matched as a literal segment — same reasoning as the household domain's
// invite routes (see householdRoutes.ts).
router.get(
  '/running',
  requireAuth,
  asyncHandler(TimesheetController.getRunning)
);

router.post(
  '/clock-in',
  ...authWithValidation(ClockInSchema, 'body'),
  asyncHandler(TimesheetController.clockIn)
);

// Forgotten clock-in recovery — literal segment before /:id.
router.post(
  '/retroactive',
  ...authWithValidation(CreateRetroactiveTimeEntrySchema, 'body'),
  asyncHandler(TimesheetController.createRetroactiveEntry)
);

router.post(
  '/:id/clock-out',
  ...authWithOwnership(TimeEntryIdParamSchema, timeEntryOwnership),
  validate(ClockOutSchema, 'body'),
  asyncHandler(TimesheetController.clockOut)
);

// The carer's correction path. Same ownership guard as clock-out — only the
// carer an entry belongs to may change it, and the service adds the
// "still editable?" gate on top (see TimesheetCommandService.updateEntry).
router.patch(
  '/:id',
  ...authWithOwnership(TimeEntryIdParamSchema, timeEntryOwnership),
  validate(UpdateTimeEntrySchema, 'body'),
  asyncHandler(TimesheetController.updateEntry)
);

export default router;
