/**
 * Schedule-pattern controller — HTTP layer ONLY.
 * @module domains/schedule/controllers/schedulePatternController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { schedulePatternCommandService } from '../services/schedulePatternCommandService';
import { schedulePatternQueryService } from '../services/schedulePatternQueryService';

export class SchedulePatternController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const schedule_patterns =
        await schedulePatternQueryService.listForHousehold(
          getAuthUserId(req),
          householdId
        );
      return sendSuccessResponse(res, 'Schedule patterns fetched', {
        schedule_patterns,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const schedule_pattern = await schedulePatternCommandService.create(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Schedule pattern created',
        { schedule_pattern },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const patternId = req.params.patternId as string;
      const schedule_pattern = await schedulePatternQueryService.getWithDays(
        getAuthUserId(req),
        patternId
      );
      return sendSuccessResponse(res, 'Schedule pattern fetched', {
        schedule_pattern,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const patternId = req.params.patternId as string;
      const schedule_pattern = await schedulePatternCommandService.update(
        getAuthUserId(req),
        patternId,
        req.body
      );
      return sendSuccessResponse(res, 'Schedule pattern updated', {
        schedule_pattern,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async replaceDays(req: Request, res: Response, next: NextFunction) {
    try {
      const patternId = req.params.patternId as string;
      const schedule_pattern = await schedulePatternCommandService.replaceDays(
        getAuthUserId(req),
        patternId,
        req.body
      );
      return sendSuccessResponse(res, 'Schedule pattern days replaced', {
        schedule_pattern,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async send(req: Request, res: Response, next: NextFunction) {
    try {
      const patternId = req.params.patternId as string;
      const schedule_pattern = await schedulePatternCommandService.send(
        getAuthUserId(req),
        patternId
      );
      return sendSuccessResponse(res, 'Schedule pattern sent', {
        schedule_pattern,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async respond(req: Request, res: Response, next: NextFunction) {
    try {
      const patternId = req.params.patternId as string;
      const schedule_pattern = await schedulePatternCommandService.respond(
        getAuthUserId(req),
        patternId,
        req.body
      );
      return sendSuccessResponse(res, 'Response recorded', {
        schedule_pattern,
      });
    } catch (error) {
      return next(error);
    }
  }

  static async withdraw(req: Request, res: Response, next: NextFunction) {
    try {
      const patternId = req.params.patternId as string;
      const schedule_pattern = await schedulePatternCommandService.withdraw(
        getAuthUserId(req),
        patternId
      );
      return sendSuccessResponse(res, 'Schedule pattern withdrawn', {
        schedule_pattern,
      });
    } catch (error) {
      return next(error);
    }
  }
}
