/**
 * Timesheet controller — HTTP layer ONLY.
 * @module domains/timesheet/controllers/timesheetController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { timesheetCommandService } from '../services/timesheetCommandService';
import { timesheetQueryService } from '../services/timesheetQueryService';
import type { WeekQuery } from '../types';

export class TimesheetController {
  /** POST /time-entries/clock-in. */
  static async clockIn(req: Request, res: Response, next: NextFunction) {
    try {
      const time_entry = await timesheetCommandService.clockIn(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(res, 'Clocked in', { time_entry }, 201);
    } catch (error) {
      return next(error);
    }
  }

  /** POST /time-entries/:id/clock-out. */
  static async clockOut(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const time_entry = await timesheetCommandService.clockOut(
        getAuthUserId(req),
        id,
        req.body
      );
      return sendSuccessResponse(res, 'Clocked out', { time_entry });
    } catch (error) {
      return next(error);
    }
  }

  /** PATCH /time-entries/:id — the carer's correction path (Daylight UX P0-2). */
  static async updateEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const time_entry = await timesheetCommandService.updateEntry(
        getAuthUserId(req),
        id,
        req.body
      );
      return sendSuccessResponse(res, 'Time entry updated', { time_entry });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /time-entries/retroactive — forgotten clock-in recovery. */
  static async createRetroactiveEntry(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const time_entry = await timesheetCommandService.createRetroactiveEntry(
        getAuthUserId(req),
        req.body
      );
      return sendSuccessResponse(
        res,
        'Retroactive time entry created',
        { time_entry },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /** GET /time-entries/running — the caller's open entry, or null. */
  static async getRunning(req: Request, res: Response, next: NextFunction) {
    try {
      const time_entry = await timesheetQueryService.getRunning(
        getAuthUserId(req)
      );
      return sendSuccessResponse(res, 'Running entry fetched', { time_entry });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/time-entries?week_start=. */
  static async listForHouseholdWeek(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const { week_start } = req.validatedQuery as unknown as WeekQuery;
      const time_entries = await timesheetQueryService.listForHouseholdWeek(
        getAuthUserId(req),
        householdId,
        week_start
      );
      return sendSuccessResponse(res, 'Time entries fetched', {
        time_entries,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/timesheets. */
  static async listTimesheetsForHousehold(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const timesheets = await timesheetQueryService.listTimesheetsForHousehold(
        getAuthUserId(req),
        householdId
      );
      return sendSuccessResponse(res, 'Timesheets fetched', { timesheets });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /timesheets/:id/approve — parents only. */
  static async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const timesheet = await timesheetCommandService.approve(
        getAuthUserId(req),
        id
      );
      return sendSuccessResponse(res, 'Timesheet approved', { timesheet });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /timesheets/:id/query — parents only. */
  static async query(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const timesheet = await timesheetCommandService.query(
        getAuthUserId(req),
        id,
        req.body
      );
      return sendSuccessResponse(res, 'Timesheet queried', { timesheet });
    } catch (error) {
      return next(error);
    }
  }
}
