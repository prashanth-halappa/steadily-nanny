/**
 * Availability controller — HTTP layer ONLY.
 * @module domains/availability/controllers/availabilityController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import type { BusyBlocksQuery } from '../schemas';
import { availabilityCommandService } from '../services/availabilityCommandService';
import { availabilityQueryService } from '../services/availabilityQueryService';

export class AvailabilityController {
  /** GET /availability/me — the caller's own weekday rows. */
  static async listOwn(req: Request, res: Response, next: NextFunction) {
    try {
      const carer_availability = await availabilityQueryService.listOwn(
        getAuthUserId(req)
      );
      return sendSuccessResponse(res, 'Availability fetched', {
        carer_availability,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** PUT /availability/me — upsert one weekday row; response is singular. */
  static async upsertOwn(req: Request, res: Response, next: NextFunction) {
    try {
      const carer_availability = await availabilityCommandService.upsertWeekday(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(res, 'Availability updated', {
        carer_availability,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /availability/:userId — shared-household-gated. */
  static async listForUser(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.params.userId as string;
      const carer_availability = await availabilityQueryService.listForUser(
        getAuthUserId(req),
        userId
      );
      return sendSuccessResponse(res, 'Availability fetched', {
        carer_availability,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /availability/:carerId/busy?from=&to= — anonymised busy blocks. */
  static async listBusyBlocks(req: Request, res: Response, next: NextFunction) {
    try {
      const carerId = req.params.carerId as string;
      const { from, to } = req.validatedQuery as unknown as BusyBlocksQuery;
      const busy_blocks = await availabilityQueryService.listBusyBlocks(
        getAuthUserId(req),
        carerId,
        from,
        to
      );
      return sendSuccessResponse(res, 'Busy blocks fetched', { busy_blocks });
    } catch (error) {
      return next(error);
    }
  }
}
