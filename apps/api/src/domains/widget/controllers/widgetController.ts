/**
 * Widget controller — HTTP layer ONLY. Validated input is read off `req`; each
 * method calls ONE service method and shapes the response via
 * `sendSuccessResponse`. Errors go to `next(error)` for the global handler to
 * classify (gating errors become 402/429 envelopes).
 *
 * @module domains/widget/controllers/widgetController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { widgetCommandService } from '../services/widgetCommandService';
import { widgetQueryService } from '../services/widgetQueryService';

/**
 * Reads the `widgetId` URL param. Safe on any /:widgetId route because
 * `validate(WidgetIdParamSchema, 'params')` (via the ownership preset) guarantees
 * it — mirrors the `getAuthUserId` "unreachable" guard.
 */
function widgetIdOf(req: Request): string {
  const id = req.params.widgetId;
  if (typeof id !== 'string') {
    throw new Error('Unreachable: WidgetIdParamSchema guarantees widgetId');
  }
  return id;
}

/**
 * Derive a human display name from the authed user to demonstrate PII masking in
 * the LLM prompt. Uses the email local-part (a stand-in for a real profile name).
 */
function ownerDisplayName(req: Request): string {
  return req.user?.email?.split('@')[0] ?? 'friend';
}

export const WidgetController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const widgets = await widgetQueryService.listForOwner(getAuthUserId(req));
      return sendSuccessResponse(res, 'Widgets fetched', { widgets });
    } catch (error) {
      return next(error);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const widget = await widgetQueryService.getOwned(
        getAuthUserId(req),
        widgetIdOf(req)
      );
      return sendSuccessResponse(res, 'Widget fetched', { widget });
    } catch (error) {
      return next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const widget = await widgetCommandService.create(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(res, 'Widget created', { widget }, 201);
    } catch (error) {
      return next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const widget = await widgetCommandService.update(
        getAuthUserId(req),
        widgetIdOf(req),
        req.body
      );
      return sendSuccessResponse(res, 'Widget updated', { widget });
    } catch (error) {
      return next(error);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await widgetCommandService.delete(getAuthUserId(req), widgetIdOf(req));
      return sendSuccessResponse(res, 'Widget deleted', { success: true });
    } catch (error) {
      return next(error);
    }
  },

  async generateDescription(req: Request, res: Response, next: NextFunction) {
    try {
      const widget = await widgetCommandService.generateDescription(
        getAuthUserId(req),
        widgetIdOf(req),
        ownerDisplayName(req)
      );
      return sendSuccessResponse(res, 'Description generated', { widget });
    } catch (error) {
      return next(error);
    }
  },

  async notify(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await widgetCommandService.notify(
        getAuthUserId(req),
        widgetIdOf(req)
      );
      return sendSuccessResponse(res, 'Notification sent', result);
    } catch (error) {
      return next(error);
    }
  },
};
