/**
 * Legal controller — HTTP layer for the legal acceptance endpoints.
 *
 * @module domains/legal/controllers/legalController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import type { AcceptLegalRequest } from '../schemas';
import { legalService } from '../services/legalService';

export const LegalController = {
  /** GET /api/v1/legal/acceptance */
  async getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await legalService.getStatus(getAuthUserId(req));
      sendSuccessResponse(res, 'Legal status', status);
    } catch (error) {
      next(error);
    }
  },

  /** POST /api/v1/legal/acceptance */
  async accept(req: Request, res: Response, next: NextFunction) {
    try {
      const status = await legalService.accept(
        getAuthUserId(req),
        req.body as AcceptLegalRequest,
        {
          ip: req.header('cf-connecting-ip') ?? req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        }
      );
      sendSuccessResponse(res, 'Legal status', status);
    } catch (error) {
      next(error);
    }
  },
};
