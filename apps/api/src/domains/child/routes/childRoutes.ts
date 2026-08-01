/**
 * Child routes — routing + middleware wiring only. Mounted at
 * `/api/v1/households/:householdId/children` in `routes/index.ts`. Role and
 * membership checks live in the service layer (see childCommandService /
 * childQueryService) rather than the generic single-param ownership
 * middleware, since these routes are scoped by TWO ids (household + child).
 *
 * @module domains/child/routes/childRoutes
 */
import { Router } from 'express';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ChildController } from '../controllers/childController';
import {
  CreateChildSchema,
  HouseholdChildParamsSchema,
  HouseholdIdOnlyParamSchema,
  UpdateChildSchema,
} from '../schemas';

// mergeParams so `:householdId` from the parent mount
// (`/households/:householdId/children`, wired in routes/index.ts) is visible
// on req.params alongside this router's own `:childId`.
const router = Router({ mergeParams: true });

router.get(
  '/',
  ...authWithValidation(HouseholdIdOnlyParamSchema, 'params'),
  asyncHandler(ChildController.list)
);

router.post(
  '/',
  ...authWithValidation(HouseholdIdOnlyParamSchema, 'params'),
  validate(CreateChildSchema, 'body'),
  asyncHandler(ChildController.create)
);

router.get(
  '/:childId',
  ...authWithValidation(HouseholdChildParamsSchema, 'params'),
  asyncHandler(ChildController.getById)
);

router.patch(
  '/:childId',
  ...authWithValidation(HouseholdChildParamsSchema, 'params'),
  validate(UpdateChildSchema, 'body'),
  asyncHandler(ChildController.update)
);

router.delete(
  '/:childId',
  ...authWithValidation(HouseholdChildParamsSchema, 'params'),
  asyncHandler(ChildController.remove)
);

export default router;
