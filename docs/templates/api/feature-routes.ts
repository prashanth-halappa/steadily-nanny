/**
 * Route skeleton — routing + middleware wiring for the `<feature>` domain.
 * Lives at: apps/api/src/domains/<feature>/routes/<feature>Routes.ts
 * (keep under ~200 lines)
 *
 * Wiring order per route: auth (+ownership) → validate(input) → asyncHandler(controller).
 * The global `validateSupabaseToken` is already applied to the whole `/api/v1`
 * mount (see `templates/api/app.ts`), so these presets add the PER-ROUTE pieces:
 * `requireAuth` (asserts `req.user` is present) + Zod validation + an optional
 * resource-ownership check. Use `authWithValidation(schema)` when there's no
 * ownership concept (e.g. `create`, which can't check ownership before the row
 * exists); use `authWithOwnership(schema, { param, lookup })` for any
 * `/:id`-shaped route. Both live in `apps/api/src/middlewares/presets.ts`.
 *
 * Wire contract: this skeleton imports request/response schemas from the
 * domain-local `../schemas` (matching how the realized widget example currently
 * keeps its schema self-contained, per its own header comment). For a REAL
 * feature, prefer defining the wire schema once in
 * `packages/shared-types/src/schemas/<feature>.schema.ts` (see
 * `templates/shared/widget.schema.ts`) so both apps import the identical shape —
 * `packages/shared-types/src/schemas/widget.schema.ts` is the worked example of
 * that promoted pattern.
 *
 * After creating this file, mount it in `apps/api/src/routes/index.ts`:
 *   import widgetRoutes from '../domains/widget/routes/widgetRoutes';
 *   router.use('/widgets', widgetRoutes);   // -> /api/v1/widgets/...
 */

import { Router } from 'express';
import { requireAuth } from '../../../middlewares/auth';
import {
  authWithOwnership,
  authWithValidation,
} from '../../../middlewares/presets';
import { asyncHandler } from '../../../utils/asyncHandler';
import { WidgetController } from '../controllers/widgetController';
import { CreateWidgetSchema, WidgetIdParamSchema } from '../schemas';
import { widgetService } from '../services/widgetService';
import type { Widget } from '../types';

const router = Router();

// Shared ownership guard for /:widgetId routes — the lookup MUST throw
// NotFoundError for both "missing" and "not yours" (see feature-service.ts).
const widgetOwnership = {
  param: 'widgetId',
  lookup: (userId: string, widgetId: string): Promise<Widget> =>
    widgetService.getOwned(userId, widgetId),
};

// No params/body to validate on a plain list — just require auth.
router.get('/', requireAuth, asyncHandler(WidgetController.list));

router.get(
  '/:widgetId',
  ...authWithOwnership(WidgetIdParamSchema, widgetOwnership),
  asyncHandler(WidgetController.getById)
);

router.post(
  '/',
  ...authWithValidation(CreateWidgetSchema, 'body'),
  asyncHandler(WidgetController.create)
);

export default router;
