/**
 * Timesheet controller — HTTP layer ONLY.
 * @module domains/timesheet/controllers/timesheetController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { timesheetCommandService } from '../services/timesheetCommandService';
import { timesheetQueryService } from '../services/timesheetQueryService';
import type {
  CarerPaySummaryQuery,
  CarerQuery,
  WeekQuery,
  YearEndSummaryQuery,
} from '../types';

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

  /**
   * GET /households/:householdId/timesheets/pay-summary.csv (D-29, P11) —
   * the nanny's own pay record (her weeks, gross, YTD), or a parent's
   * carer-scoped read of one. Same download-not-envelope shape as
   * `exportCsv`; every refusal is decided in the service.
   */
  static async exportCarerPaySummaryCsv(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const query = req.validatedQuery as unknown as CarerPaySummaryQuery;
      const { from, to } = query.year
        ? { from: `${query.year}-01-01`, to: `${query.year}-12-31` }
        : { from: query.from as string, to: query.to as string };
      const { filename, csv } =
        await timesheetQueryService.exportCarerPaySummaryCsv(
          getAuthUserId(req),
          householdId,
          { carerId: query.carer_id, from, to }
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

  /**
   * GET /households/:householdId/timesheets/year-end.csv (D-29, P12) — the
   * parent's calendar-year payroll handoff, one row per carer.
   */
  static async exportYearEndSummaryCsv(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const { year } = req.validatedQuery as unknown as YearEndSummaryQuery;
      const { filename, csv } =
        await timesheetQueryService.exportYearEndSummaryCsv(
          getAuthUserId(req),
          householdId,
          year
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

  /**
   * POST /timesheets/:id/approve — parents only.
   *
   * The body carries the optional final adjustment; it is validated (and
   * defaulted to `{}` for a bodyless legacy request) by the route's
   * `ApproveTimesheetSchema`, so this layer passes it straight through.
   */
  static async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const timesheet = await timesheetCommandService.approve(
        getAuthUserId(req),
        id,
        req.body
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

  /**
   * GET /timesheets/:id/thread — what was said about this week, both sides.
   *
   * No ownership middleware on the route, deliberately: the gate lives in
   * `timesheetQueryService.getThread`, which is the WIDER read gate. See the
   * route file and GOLDEN-FIXES #32.
   */
  static async getThread(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const thread = await timesheetQueryService.getThread(
        getAuthUserId(req),
        id
      );
      return sendSuccessResponse(res, 'Timesheet thread fetched', { thread });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /timesheets/:id/thread — a reply from either side (D-18 / D-46). */
  static async addThreadMessage(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = req.params.id as string;
      const thread = await timesheetCommandService.addThreadMessage(
        getAuthUserId(req),
        id,
        req.body
      );
      return sendSuccessResponse(res, 'Note added', { thread }, 201);
    } catch (error) {
      return next(error);
    }
  }

  /** POST /timesheets/:id/withdraw-query — parents only. Exit from queried (D-19). */
  static async withdrawQuery(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const timesheet = await timesheetCommandService.withdrawQuery(
        getAuthUserId(req),
        id
      );
      return sendSuccessResponse(res, 'Query withdrawn', { timesheet });
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
