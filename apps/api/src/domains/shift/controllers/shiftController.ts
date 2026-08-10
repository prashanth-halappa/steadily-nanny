/**
 * Shift controller — HTTP layer ONLY.
 * @module domains/shift/controllers/shiftController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { collectClashWarningsForCarer } from '../../me/services/clashWarning';
import { shiftCommandService } from '../services/shiftCommandService';
import { shiftQueryService } from '../services/shiftQueryService';
import type { ShiftRangeQuery } from '../types';

export class ShiftController {
  /** The primary calendar feed: GET /households/:householdId/shifts?from=&to=. */
  static async listForHousehold(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const { from, to } = req.validatedQuery as unknown as ShiftRangeQuery;
      const shifts = await shiftQueryService.listForHousehold(
        getAuthUserId(req),
        householdId,
        from,
        to
      );
      return sendSuccessResponse(res, 'Shifts fetched', { shifts });
    } catch (error) {
      return next(error);
    }
  }

  /** One shift with its children: GET /shifts/:shiftId. */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.params.shiftId as string;
      const shift = await shiftQueryService.getOwned(
        getAuthUserId(req),
        shiftId
      );
      return sendSuccessResponse(res, 'Shift fetched', { shift });
    } catch (error) {
      return next(error);
    }
  }

  /** The append-only day thread: GET /households/:householdId/shifts/:shiftId/events. */
  static async listEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const shiftId = req.params.shiftId as string;
      const shift_events = await shiftQueryService.listEvents(
        getAuthUserId(req),
        householdId,
        shiftId
      );
      return sendSuccessResponse(res, 'Shift events fetched', {
        shift_events,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** Parent-only time/note edit: PATCH /shifts/:shiftId. */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.params.shiftId as string;
      const shift = await shiftCommandService.update(
        getAuthUserId(req),
        shiftId,
        req.body
      );
      const warnings =
        shift.carer_id != null
          ? await collectClashWarningsForCarer(
              shift.carer_id,
              {
                startsAt: shift.starts_at,
                endsAt: shift.ends_at,
                timezone: shift.timezone,
              },
              {
                ignoreExact: { sourceUid: shift.ical_uid },
              }
            )
          : [];
      return sendSuccessResponse(res, 'Shift updated', { shift, warnings });
    } catch (error) {
      return next(error);
    }
  }

  /** Carer-only accept pending → confirmed: POST /shifts/:shiftId/accept. */
  static async accept(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.params.shiftId as string;
      const shift = await shiftCommandService.accept(
        getAuthUserId(req),
        shiftId
      );
      const warnings =
        shift.carer_id != null
          ? await collectClashWarningsForCarer(
              shift.carer_id,
              {
                startsAt: shift.starts_at,
                endsAt: shift.ends_at,
                timezone: shift.timezone,
              },
              {
                ignoreExact: { sourceUid: shift.ical_uid },
              }
            )
          : [];
      return sendSuccessResponse(res, 'Shift accepted', { shift, warnings });
    } catch (error) {
      return next(error);
    }
  }

  /** Carer-only decline pending → declined: POST /shifts/:shiftId/decline. */
  static async decline(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.params.shiftId as string;
      const shift = await shiftCommandService.decline(
        getAuthUserId(req),
        shiftId
      );
      return sendSuccessResponse(res, 'Shift declined', { shift });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Carer-only running-late signal: POST /shifts/:shiftId/running-late.
   *
   * Body-less on purpose. It carries no ETA and no minute count — the event is
   * a message to the family, not a measurement of her. Both the carer and the
   * parent asked us not to create a punctuality record, and a payload with
   * "how late" in it is one waiting to be aggregated.
   */
  static async runningLate(req: Request, res: Response, next: NextFunction) {
    try {
      const shiftId = req.params.shiftId as string;
      await shiftCommandService.runningLate(getAuthUserId(req), shiftId);
      return sendSuccessResponse(res, 'Family notified', {});
    } catch (error) {
      return next(error);
    }
  }

  /** Parent self-cover: POST /households/:householdId/shifts/parent-cover. */
  static async createParentCover(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const shift = await shiftCommandService.createParentCover(
        getAuthUserId(req),
        householdId,
        req.body
      );
      return sendSuccessResponse(res, 'Parent cover created', { shift });
    } catch (error) {
      return next(error);
    }
  }

  /** Undo parent self-cover: DELETE /shifts/:shiftId/parent-cover. */
  static async removeParentCover(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const shiftId = req.params.shiftId as string;
      await shiftCommandService.removeParentCover(getAuthUserId(req), shiftId);
      return sendSuccessResponse(res, 'Parent cover removed', {});
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Household/date day thread: GET /households/:householdId/day-thread?local_date=
   * Includes nullable-shift_id events; does not widen the shift-scoped events route.
   */
  static async listDayThread(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const { local_date } = req.validatedQuery as unknown as {
        local_date: string;
      };
      const shift_events = await shiftQueryService.listDayThread(
        getAuthUserId(req),
        householdId,
        local_date
      );
      return sendSuccessResponse(res, 'Day thread fetched', { shift_events });
    } catch (error) {
      return next(error);
    }
  }
}
