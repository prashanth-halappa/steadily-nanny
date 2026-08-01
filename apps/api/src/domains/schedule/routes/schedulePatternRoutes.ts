/**
 * Schedule-pattern routes (flat, id-scoped) — routing + middleware wiring
 * only. Mounted at `/api/v1/schedule-patterns` in `routes/index.ts`. Once you
 * have a `:patternId`, its household is derivable via a lookup, so these
 * routes don't need `:householdId` in the path — the same shape as the
 * household domain's `/:householdId` routes.
 *
 * @module domains/schedule/routes/schedulePatternRoutes
 */
import { Router } from 'express';
import { authWithOwnership } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { SchedulePatternController } from '../controllers/schedulePatternController';
import {
  ReplaceSchedulePatternDaysSchema,
  RespondToSchedulePatternSchema,
  SchedulePatternIdParamSchema,
  UpdateSchedulePatternSchema,
} from '../schemas';
import { schedulePatternQueryService } from '../services/schedulePatternQueryService';
import type { SchedulePattern } from '../types';

const router = Router();

// Shared ownership guard for /:patternId routes. The lookup throws
// SchedulePatternNotFoundError (-> 404) for both "missing" and "not a member
// of its household" — see schedulePatternQueryService.getOwned.
const patternOwnership = {
  param: 'patternId',
  lookup: (userId: string, patternId: string): Promise<SchedulePattern> =>
    schedulePatternQueryService.getOwned(userId, patternId),
};

// Read one, with its full day/children breakdown.
router.get(
  '/:patternId',
  ...authWithOwnership(SchedulePatternIdParamSchema, patternOwnership),
  asyncHandler(SchedulePatternController.getById)
);

// Update the pattern's own fields — draft only (command service enforces).
router.patch(
  '/:patternId',
  ...authWithOwnership(SchedulePatternIdParamSchema, patternOwnership),
  validate(UpdateSchedulePatternSchema, 'body'),
  asyncHandler(SchedulePatternController.update)
);

// Days (and their children) are nested resources clients replace wholesale.
router.put(
  '/:patternId/days',
  ...authWithOwnership(SchedulePatternIdParamSchema, patternOwnership),
  validate(ReplaceSchedulePatternDaysSchema, 'body'),
  asyncHandler(SchedulePatternController.replaceDays)
);

// draft -> pending.
router.post(
  '/:patternId/send',
  ...authWithOwnership(SchedulePatternIdParamSchema, patternOwnership),
  asyncHandler(SchedulePatternController.send)
);

// The carer accepts/declines. Accepting materialises shifts.
router.post(
  '/:patternId/respond',
  ...authWithOwnership(SchedulePatternIdParamSchema, patternOwnership),
  validate(RespondToSchedulePatternSchema, 'body'),
  asyncHandler(SchedulePatternController.respond)
);

// pending -> withdrawn.
router.post(
  '/:patternId/withdraw',
  ...authWithOwnership(SchedulePatternIdParamSchema, patternOwnership),
  asyncHandler(SchedulePatternController.withdraw)
);

export default router;
