/**
 * Flat, id-scoped timesheet action routes — routing + middleware wiring
 * only. Mounted at `/api/v1/timesheets` in `routes/index.ts`.
 *
 * @module domains/timesheet/routes/timesheetRoutes
 */
import { Router } from 'express';
import {
  authWithOwnership,
  authWithValidation,
} from '../../../middlewares/presets';
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

// Ownership guard for the ACTION routes. The lookup throws
// TimesheetNotFoundError (-> 404) for both "missing" and "not an ACTIVE
// member" — see timesheetQueryService.getOwnedTimesheet. Role (parent-only)
// is enforced in timesheetCommandService.
const timesheetOwnership = {
  param: 'id',
  lookup: (userId: string, timesheetId: string): Promise<Timesheet> =>
    timesheetQueryService.getOwnedTimesheet(userId, timesheetId),
};

// The week read. NO ownership middleware, deliberately — the read gate lives
// one layer down, in `timesheetQueryService.getReadableTimesheet`, which
// `getWeekWithEarnings` calls before it prices anything. It is a WIDER gate
// than the actions below: a member REMOVED from the household keeps access to
// the payroll she was part of (a departed nanny must still see the hours she
// worked), role-scoped there.
//
// Wiring that wider lookup into `makeOwnershipValidator` here would BREAK the
// stricter guard below, not merely duplicate it: the validator caches by
// `(userId, resourceId)` only — no lookup identity — so one permitted GET
// would leave a positive entry that every /:id action then reuses, skipping
// `getOwnedTimesheet` entirely and letting a removed parent approve a week.
// One id, two different permissions, one cache key. The read needs no
// middleware anyway; the controller re-reads through the gate regardless.
router.get(
  '/:id',
  ...authWithValidation(TimesheetIdParamSchema),
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
