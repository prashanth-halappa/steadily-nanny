/**
 * Controller skeleton — HTTP layer ONLY for the `<feature>` domain.
 * Lives at: apps/api/src/controllers/<feature>Controller.ts
 *
 * Rules:
 *  - No business logic here. Pull validated input off `req`, call ONE service
 *    method, shape the response. Push errors to `next(error)` for the global handler.
 *  - Input is already validated by the `validate(schema)` middleware on the route,
 *    so `req.body` / `req.params` are safe to read.
 *  - `getAuthUserId(req)` reads the user id the auth middleware attached to the request.
 */

import type { NextFunction, Request, Response } from 'express';
import { widgetService } from '../domains/widget/services/widgetService';
import { getAuthUserId } from '../utils/getAuthUserId';
import { sendSuccessResponse } from '../utils/response';

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
      const widget = await widgetService.getOwned(getAuthUserId(req), req.params.widgetId);
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
