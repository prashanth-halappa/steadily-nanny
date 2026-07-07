/**
 * Widget routes — routing + middleware wiring only. Mounted at `/api/v1/widgets`
 * (behind the global Supabase auth). Each route reads as one declarative chain:
 * auth → validate/ownership → asyncHandler(controller).
 *
 * @module domains/widget/routes/widgetRoutes
 */
import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import {
  authWithOwnership,
  authWithValidation,
} from '../../../middlewares/presets';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { WidgetController } from '../controllers/widgetController';
import {
  CreateWidgetSchema,
  UpdateWidgetSchema,
  WidgetIdParamSchema,
} from '../schemas';
import { widgetQueryService } from '../services/widgetQueryService';
import type { Widget } from '../types';

const router = Router();

// Shared ownership guard for /:widgetId routes. The lookup throws
// WidgetNotFoundError (→ 404) when the widget is missing OR not the caller's, so
// every id-scoped route is authorized before its controller runs (and the
// looked-up widget is cached + attached to the request).
const widgetOwnership = {
  param: 'widgetId',
  lookup: (userId: string, widgetId: string): Promise<Widget> =>
    widgetQueryService.getOwned(userId, widgetId),
};

// List the caller's own widgets.
router.get('/', requireAuth, asyncHandler(WidgetController.list));

// Create — GATED by `widget_creation` quota in the command service.
router.post(
  '/',
  ...authWithValidation(CreateWidgetSchema, 'body'),
  asyncHandler(WidgetController.create)
);

// Read one (ownership-checked).
router.get(
  '/:widgetId',
  ...authWithOwnership(WidgetIdParamSchema, widgetOwnership),
  asyncHandler(WidgetController.getById)
);

// Update mutable fields.
router.patch(
  '/:widgetId',
  ...authWithOwnership(WidgetIdParamSchema, widgetOwnership),
  validate(UpdateWidgetSchema, 'body'),
  asyncHandler(WidgetController.update)
);

// Delete.
router.delete(
  '/:widgetId',
  ...authWithOwnership(WidgetIdParamSchema, widgetOwnership),
  asyncHandler(WidgetController.remove)
);

// Generate an AI description — GATED by `llm_generation`; degrades gracefully.
router.post(
  '/:widgetId/generate-description',
  ...authWithOwnership(WidgetIdParamSchema, widgetOwnership),
  asyncHandler(WidgetController.generateDescription)
);

// Push a "widget ready" notification to the caller's own devices.
router.post(
  '/:widgetId/notify',
  ...authWithOwnership(WidgetIdParamSchema, widgetOwnership),
  asyncHandler(WidgetController.notify)
);

export default router;
