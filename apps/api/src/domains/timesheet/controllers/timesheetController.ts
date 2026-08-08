/**
 * Timesheet controller — HTTP layer ONLY.
 * @module domains/timesheet/controllers/timesheetController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { timesheetCommandService } from '../services/timesheetCommandService';
import { timesheetQueryService } from '../services/timesheetQueryService';
import type { CarerQuery, WeekQuery } from '../types';

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

  /** DELETE /time-entries/:id — soft-delete (void) the carer's own entry. */
  static async voidEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const time_entry = await timesheetCommandService.voidEntry(
        getAuthUserId(req),
        id
      );
      return sendSuccessResponse(res, 'Time entry voided', { time_entry });
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

  /** GET /households/:householdId/time-entries?week_start=&carer_id=. */
  static async listForHouseholdWeek(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const { week_start, carer_id } =
        req.validatedQuery as unknown as WeekQuery;
      const time_entries = await timesheetQueryService.listForHouseholdWeek(
        getAuthUserId(req),
        householdId,
        week_start,
        carer_id
      );
      return sendSuccessResponse(res, 'Time entries fetched', {
        time_entries,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/timesheets?carer_id=. */
  static async listTimesheetsForHousehold(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const { carer_id } = req.validatedQuery as unknown as CarerQuery;
      const timesheets = await timesheetQueryService.listTimesheetsForHousehold(
        getAuthUserId(req),
        householdId,
        carer_id
      );
      return sendSuccessResponse(res, 'Timesheets fetched', { timesheets });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /timesheets/:id — one week with its earnings attached.
   *
   * Live or frozen is decided in the service, never here and never on the
   * client (`timesheetQueryService.getWeekWithEarnings`).
   */
  static async getWeek(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const timesheet = await timesheetQueryService.getWeekWithEarnings(
        getAuthUserId(req),
        id
      );
      return sendSuccessResponse(res, 'Timesheet week fetched', { timesheet });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /timesheets/:id/export.csv — the payroll handoff file.
   *
   * The ONE timesheet response that is not the house JSON envelope: a
   * download, so it answers with `text/csv` and a `Content-Disposition`
   * filename instead of `sendSuccessResponse`. Everything else — the read
   * gate, the approved-only refusal, the bytes — is decided in the service
   * (`timesheetQueryService.exportWeekCsv`); this layer only dresses it as a
   * file. A refusal throws and lands in the usual JSON error handler, so a
   * client never receives a 409 body that looks like a spreadsheet.
   *
   * The filename is interpolated into a quoted header value, which is safe
   * because `carerSlug` reduces the carer's name to `[a-z0-9-]` and
   * `week_start` is a validated ISO date — no quote or newline can reach the
   * header (see `utils/weekExportCsv.ts`).
   */
  static async exportCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { filename, csv } = await timesheetQueryService.exportWeekCsv(
        getAuthUserId(req),
        id
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
      );
      return res.send(csv);
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

  /** POST /timesheets/:id/reopen — parents only. Undo for approve. */
  static async reopen(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const timesheet = await timesheetCommandService.reopen(
        getAuthUserId(req),
        id,
        req.body
      );
      return sendSuccessResponse(res, 'Timesheet reopened', { timesheet });
    } catch (error) {
      return next(error);
    }
  }
}
