/**
 * Pay arrangement controller — HTTP layer ONLY. Every authorization decision
 * (parent gate, carer assertion, helper denial) lives in the services; this
 * module unpacks the request and shapes the response, nothing else.
 *
 * @module domains/pay/controllers/payArrangementController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { weeklyEquivalentMinor } from '../services/earningsService';
import { payArrangementAckService } from '../services/payArrangementAckService';
import { payArrangementCommandService } from '../services/payArrangementCommandService';
import { payArrangementQueryService } from '../services/payArrangementQueryService';
import type { PayArrangement } from '../types';

/**
 * D-6/§10: attach the server-computed salary-framing figure at the WIRE edge
 * — never inside the query service, whose return type dozens of existing
 * tests already pin to the bare `PayArrangement` row. `weeklyEquivalentMinor`
 * itself carries the "never rate × hours" guard note
 * (`services/earningsService.ts`); this is only the attach point.
 */
function withWeeklyEquivalent(
  arrangement: PayArrangement
): PayArrangement & { weekly_equivalent_minor: number | null } {
  return {
    ...arrangement,
    weekly_equivalent_minor: weeklyEquivalentMinor(arrangement),
  };
}

export class PayArrangementController {
  /**
   * GET /households/:householdId/carers/:carerId/pay-arrangements/current.
   * `pay_arrangement: null` is a normal 200 — the client renders "no rate
   * set", never £0.00 (docs/11-MONEY.md §4).
   */
  static async getCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const current = await payArrangementQueryService.getCurrent(
        getAuthUserId(req),
        householdId,
        carerId
      );
      return sendSuccessResponse(res, 'Current pay arrangement fetched', {
        pay_arrangement: current ? withWeeklyEquivalent(current) : null,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET /households/:householdId/carers/:carerId/pay-arrangements — history, newest first. */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const history = await payArrangementQueryService.getHistory(
        getAuthUserId(req),
        householdId,
        carerId
      );
      return sendSuccessResponse(res, 'Pay arrangements fetched', {
        pay_arrangements: history.map(withWeeklyEquivalent),
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /households/:householdId/carers/:carerId/pay-arrangements — parents only. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const pay_arrangement = await payArrangementCommandService.create(
        getAuthUserId(req),
        householdId,
        carerId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Pay arrangement created',
        { pay_arrangement },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST .../pay-arrangements/:arrangementId/ack — D-31. Only the carer the
   * arrangement is for; the service asserts it.
   */
  static async ack(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const arrangementId = req.params.arrangementId as string;
      const pay_arrangement_ack = await payArrangementAckService.ack(
        getAuthUserId(req),
        householdId,
        carerId,
        arrangementId
      );
      return sendSuccessResponse(
        res,
        'Pay terms acknowledged',
        { pay_arrangement_ack },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST .../pay-arrangements/:arrangementId/dissent — D-45. Blocks nothing;
   * notifies the household's parents.
   */
  static async dissent(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const arrangementId = req.params.arrangementId as string;
      const pay_arrangement_ack = await payArrangementAckService.dissent(
        getAuthUserId(req),
        householdId,
        carerId,
        arrangementId,
        req.body.note
      );
      return sendSuccessResponse(
        res,
        'Dissent recorded',
        { pay_arrangement_ack },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /** GET .../pay-arrangements/:arrangementId/acks — §8.4/§8.5, both roles. */
  static async listAcks(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const arrangementId = req.params.arrangementId as string;
      const pay_arrangement_acks =
        await payArrangementAckService.listForArrangement(
          getAuthUserId(req),
          householdId,
          carerId,
          arrangementId
        );
      return sendSuccessResponse(res, 'Pay arrangement acks fetched', {
        pay_arrangement_acks,
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST .../pay-arrangements/:arrangementId/cancel-scheduled — D-16/§6.
   * Parents only; refuses once the scheduled date has arrived.
   */
  static async cancelScheduled(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const arrangementId = req.params.arrangementId as string;
      const pay_arrangement =
        await payArrangementCommandService.cancelScheduled(
          getAuthUserId(req),
          householdId,
          carerId,
          arrangementId
        );
      return sendSuccessResponse(res, 'Scheduled change cancelled', {
        pay_arrangement,
      });
    } catch (error) {
      return next(error);
    }
  }
}
