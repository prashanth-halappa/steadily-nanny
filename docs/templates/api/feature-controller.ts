/**
 * Controller skeleton — HTTP layer ONLY for the `<feature>` domain.
 * Lives at: apps/api/src/domains/<feature>/controllers/<feature>Controller.ts
 *
 * Rules:
 *  - No business logic here. Pull validated input off `req`, call ONE service
 *    method, shape the response. Push errors to `next(error)` for the global handler.
 *  - Input is already validated by the `validate(schema)` middleware on the route,
 *    so `req.body` / `req.params` are safe to read.
 *  - `getAuthUserId(req)` reads the user id the auth middleware attached to the request.
 *
 * The realized widget domain (`apps/api/src/domains/widget/`) splits reads and
 * writes into `widgetQueryService`/`widgetCommandService` (CQRS-lite) — this
 * skeleton combines them into one `<feature>Service` for a first feature; split
 * them later if the domain grows non-trivial write-side logic (gating, side
 * effects) worth isolating.
 */

import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { widgetService } from '../services/widgetService';

export class WidgetController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const widgets = await widgetService.listForOwner(getAuthUserId(req));
      return sendSuccessResponse(res, 'Widgets fetched', { widgets });
    } catch (error) {
      return next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      // `widgetId` is a string here because `validate(WidgetIdParamSchema, 'params')`
      // (wired on the route via the `authWithOwnership` preset) already ran.
      const widgetId = req.params.widgetId as string;
      const widget = await widgetService.getOwned(
        getAuthUserId(req),
        widgetId
      );
      return sendSuccessResponse(res, 'Widget fetched', { widget });
    } catch (error) {
      return next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const widget = await widgetService.create(getAuthUserId(req), req.body);
      return sendSuccessResponse(res, 'Widget created', { widget }, 201);
    } catch (error) {
      return next(error);
    }
  }
}
