/**
 * Expense routes — routing + middleware wiring only. Every authorization
 * decision (carer gate, D12-class membership assertion, owning-carer +
 * pending guard, parent-review gate, currency check) lives in
 * `expenseCommandService`/`expenseQueryService`; see those modules' docs.
 *
 * TWO routers, because the resource is addressed two different ways
 * (`TIER0-PLAN.md` Phase 4):
 *
 * - `householdExpenseRoutes` (default export) — household-nested list/create,
 *   mounted at `/api/v1/households/:householdId/expenses`. Mirrors
 *   `payArrangementRoutes`'s nested shape.
 * - `expenseIdRoutes` (named export) — flat id-scoped edit/withdraw/review,
 *   mounted at `/api/v1/expenses`. Mirrors `timeEntryRoutes`'s flat
 *   `/time-entries/:id` shape.
 *
 * `authWithValidation` EVERYWHERE, deliberately NEVER `authWithOwnership`:
 * the generic ownership middleware caches "does this user own this resource"
 * per (userId, resourceId) with no notion of WHICH action is being checked
 * (`middlewares/validateResourceOwnership.ts`). An expense id has TWO
 * different "may write" meanings depending on the route — "is this MY
 * pending claim" (update/withdraw) vs "am I a PARENT of its household"
 * (review) — sharing that cache under one key would let a positive hit for
 * one meaning leak into the other. So, exactly like `payArrangementRoutes`,
 * every check lives at the top of its service method instead, and these
 * routes only validate SHAPE (uuid params, request body against the shared
 * wire schemas).
 *
 * @module domains/pay/routes/expenseRoutes
 */

import {
  CreateExpenseRequestSchema,
  ReviewExpenseRequestSchema,
  UpdateExpenseRequestSchema,
} from '@steadily-nanny/shared-types/schemas/expense.schema';
import { Router } from 'express';
import { z } from 'zod';
import { authWithValidation } from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ExpenseController } from '../controllers/expenseController';

/** URL param validation for /households/:householdId/expenses. */
const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});

/** URL param validation for /expenses/:expenseId/*. */
const ExpenseIdParamSchema = z.object({
  expenseId: z.uuid(),
});

/**
 * Query validation for GET /households/:householdId/expenses?week_start=&status=.
 * Both optional: omitting `week_start` means "the current household-local
 * week" (resolved server-side, `expenseQueryService.listForWeek`);
 * `status=pending` switches the same endpoint to the review-queue read
 * instead (`ExpenseController.list`).
 */
const ExpenseListQuerySchema = z.object({
  week_start: z.iso.date().optional(),
  status: z.enum(['pending']).optional(),
});

// mergeParams so `:householdId` from the parent mount is visible on req.params.
const householdRouter = Router({ mergeParams: true });

householdRouter.get(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(ExpenseListQuerySchema, 'query'),
  asyncHandler(ExpenseController.list)
);

householdRouter.post(
  '/',
  ...authWithValidation(HouseholdIdParamSchema, 'params'),
  validate(CreateExpenseRequestSchema, 'body'),
  asyncHandler(ExpenseController.create)
);

const idRouter = Router();

idRouter.patch(
  '/:expenseId',
  ...authWithValidation(ExpenseIdParamSchema, 'params'),
  validate(UpdateExpenseRequestSchema, 'body'),
  asyncHandler(ExpenseController.update)
);

idRouter.delete(
  '/:expenseId',
  ...authWithValidation(ExpenseIdParamSchema, 'params'),
  asyncHandler(ExpenseController.withdraw)
);

idRouter.post(
  '/:expenseId/review',
  ...authWithValidation(ExpenseIdParamSchema, 'params'),
  validate(ReviewExpenseRequestSchema, 'body'),
  asyncHandler(ExpenseController.review)
);

export { idRouter as expenseIdRoutes };
export default householdRouter;
