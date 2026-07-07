/**
 * Route skeleton — routing + middleware wiring for the `<feature>` domain.
 * Lives at: apps/api/src/routes/<feature>Routes.ts  (keep under ~200 lines)
 *
 * Wiring order per route: auth → validate(input) → asyncHandler(controller).
 * `requireAuth` here is shorthand; in this stack the global `validateSupabaseToken`
 * is already applied to the whole `/api/v1` mount (see templates/api/app.ts), so a
 * route file often only needs `validate()` + the handler. Use a preset spread
 * (e.g. `...authWithOwnerParam(schema)`) when you have a reusable auth+validate chain.
 *
 * After creating this file, mount it in src/routes/index.ts:
 *   router.use('/widgets', widgetRoutes);   // -> /api/v1/widgets/...
 */

import { Router } from 'express';
import { WidgetController } from '../controllers/widgetController';
import { validate } from '../middlewares';
import {
  CreateWidgetSchema,
  WidgetIdParamSchema,
} from '../schemas/widget.schema';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.get('/', asyncHandler(WidgetController.list));

router.get(
  '/:widgetId',
  validate(WidgetIdParamSchema, 'params'),
  asyncHandler(WidgetController.getById)
);

router.post(
  '/',
  validate(CreateWidgetSchema, 'body'),
  asyncHandler(WidgetController.create)
);

export default router;
