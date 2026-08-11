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
  AddTimesheetThreadMessageSchema,
  ApproveTimesheetSchema,
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

// The payroll export — the SAME gate as the read above, and for the same
// reason: it is the same week, in a file. No ownership middleware, so the
// service's `getReadableTimesheet` decides (any active member; a removed
// member keeps the payroll she was part of, role-scoped there), and no cache
// entry is left behind for the ACTION routes below to reuse.
//
// Only an APPROVED week exports — refused with TimesheetNotExportableError
// (409) in the service, never here.
router.get(
  '/:id/export.csv',
  ...authWithValidation(TimesheetIdParamSchema),
  asyncHandler(TimesheetController.exportCsv)
);

// Approve gains BODY validation and nothing else — the ownership preset above
// it is untouched, in the same position, with the same lookup. That is not a
// stylistic preference: `makeOwnershipValidator` caches by
// `(userId, resourceId)` with no lookup identity (see the GET comment above),
// so any rearrangement here risks the exact cache-poisoning class GOLDEN-FIXES
// #31 documents. `validate(..., 'body')` sits AFTER ownership, matching
// /query and /reopen below.
//
// The body is optional in shape (`{}` and `{adjustment: null}` both pass), so
// every client shipped before the adjustment existed keeps working unchanged.
// `.default({})` is what makes that literally true rather than nearly true:
// every shipped client posts approve with NO body and NO content-type, and
// Express 5's body-parser leaves `req.body` UNDEFINED in that case (it is not
// the `{}` Express 4 handed you). Without the default, adding validation to a
// previously unvalidated route would 400 every existing app on first tap.
router.post(
  '/:id/approve',
  ...authWithOwnership(TimesheetIdParamSchema, timesheetOwnership),
  validate(ApproveTimesheetSchema.default({}), 'body'),
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

// The week thread (D-18 / D-19 / D-46). The READ carries NO ownership
// middleware for exactly the reason the GET above does not: its gate
// (`getThread` → `getReadableTimesheet`) is WIDER than the actions', and
// `makeOwnershipValidator` caches by `(userId, resourceId)` with no lookup
// identity — one permitted thread read would leave a positive entry
// `/approve` reuses, handing a removed parent an approval. GOLDEN-FIXES #32.
router.get(
  '/:id/thread',
  ...authWithValidation(TimesheetIdParamSchema),
  asyncHandler(TimesheetController.getThread)
);

// The WRITES do take the ownership preset — an ACTIVE membership is the floor
// for saying anything, and role/status gating (carer any week, parent only a
// queried one) is enforced one layer down in the command service, matching
// /approve, /query and /reopen.
router.post(
  '/:id/thread',
  ...authWithOwnership(TimesheetIdParamSchema, timesheetOwnership),
  validate(AddTimesheetThreadMessageSchema, 'body'),
  asyncHandler(TimesheetController.addThreadMessage)
);

router.post(
  '/:id/withdraw-query',
  ...authWithOwnership(TimesheetIdParamSchema, timesheetOwnership),
  asyncHandler(TimesheetController.withdrawQuery)
);

export default router;
