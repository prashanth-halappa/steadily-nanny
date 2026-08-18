/**
 * Terms-proposal controller — HTTP layer ONLY. Every authorization decision
 * (the read circle, the author gate, the parents-only accept) lives in the
 * services; this module unpacks the request, attaches the one server-computed
 * figure, and shapes the response.
 *
 * @module domains/termsProposal/controllers/termsProposalController
 */
import type { NextFunction, Request, Response } from 'express';
import { getAuthUserId } from '../../../utils/asyncHandler';
import { sendSuccessResponse } from '../../../utils/responseHelpers';
import { weeklyEquivalentMinor } from '../../pay/services/earningsService';
import type { PayArrangement } from '../../pay/types';
import type { TermsProposal, TermsProposalRow } from '../schemas';
import { termsProposalCommandService } from '../services/termsProposalCommandService';
import { termsProposalQueryService } from '../services/termsProposalQueryService';

/**
 * Attach `weekly_equivalent_minor` at the WIRE EDGE — the same place and the
 * same way `payArrangementController.withWeeklyEquivalent` does it, and for
 * the same reason: the services' return types are the bare row, and the
 * figure is not a column.
 *
 * §17/D23, THE RULE THIS FUNCTION EXISTS TO ENFORCE: no client anywhere in
 * 3-O may compute `rate x hours`. At $28.00/hr with overtime after 40h, 50
 * guaranteed hours is $1,540.00 (40 x 2800 + 10 x 4200) — a naive multiply
 * prints $1,400.00, which is the precise error David named as his own
 * trust-killer, on the screen where the contract is signed. Routing through
 * `weeklyEquivalentMinor` prices the figure through the SAME engine that
 * prices a real week, so it cannot drift from what payroll will actually say.
 *
 * The throwaway object below is `PayArrangement`-SHAPED but is not one and
 * never reaches a database: `terms` is spread LAST so every field the parties
 * actually agreed wins, and so a pay term added in some future migration
 * flows through here for free rather than silently pricing as null (T17's
 * field-by-field trap, which is exactly why `terms` is one bag in the first
 * place). The ids and timestamps are the PROPOSAL's — nothing here has an
 * arrangement id, because no arrangement exists until someone agrees.
 */
export function withWeeklyEquivalent(row: TermsProposalRow): TermsProposal {
  const shaped: PayArrangement = {
    id: row.id,
    household_id: row.household_id,
    carer_id: row.carer_id,
    bill_rate_minor: null,
    overtime_threshold_minutes: null,
    guaranteed_minutes_per_week: null,
    pto_entitlement_minutes_per_year: null,
    mileage_rate_per_mile_minor: null,
    cancellation_paid_within_hours: null,
    valid_to: null,
    carer_display_name: row.carer_display_name,
    note: row.note,
    created_by: row.proposed_by,
    created_at: row.created_at,
    ...row.terms,
    currency: row.terms.currency ?? 'USD',
  };
  return { ...row, weekly_equivalent_minor: weeklyEquivalentMinor(shaped) };
}

export class TermsProposalController {
  /**
   * GET /households/:householdId/carers/:carerId/terms-proposals/current.
   * `terms_proposal: null` is a normal 200 — a settled household has no open
   * round, and nothing announces its absence (§12).
   */
  static async getCurrent(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const open = await termsProposalQueryService.getOpen(
        getAuthUserId(req),
        householdId,
        carerId
      );
      return sendSuccessResponse(res, 'Terms proposal fetched', {
        terms_proposal: open ? withWeeklyEquivalent(open) : null,
      });
    } catch (error) {
      return next(error);
    }
  }

  /** GET .../terms-proposals — §7.2's "How we got here", newest first. */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const chain = await termsProposalQueryService.getChain(
        getAuthUserId(req),
        householdId,
        carerId
      );
      return sendSuccessResponse(res, 'Terms proposals fetched', {
        terms_proposals: chain.map(withWeeklyEquivalent),
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST .../terms-proposals — propose, or counter with `supersedes_id`. */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const householdId = req.params.householdId as string;
      const carerId = req.params.carerId as string;
      const created = await termsProposalCommandService.propose(
        getAuthUserId(req),
        householdId,
        carerId,
        req.body
      );
      return sendSuccessResponse(
        res,
        'Terms proposed',
        { terms_proposal: withWeeklyEquivalent(created) },
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /terms-proposals/:proposalId — the review screen's own load.
   *
   * Id-scoped, because the screen is reached from a push carrying only
   * `data.proposalId`; the service resolves the household and carer from the
   * row and gates against those.
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const proposalId = req.params.proposalId as string;
      const proposal = await termsProposalQueryService.getById(
        getAuthUserId(req),
        proposalId
      );
      return sendSuccessResponse(res, 'Terms proposal fetched', {
        terms_proposal: withWeeklyEquivalent(proposal),
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /terms-proposals/:proposalId/accept — §7.3, the binding act. */
  static async accept(req: Request, res: Response, next: NextFunction) {
    try {
      const proposalId = req.params.proposalId as string;
      const accepted = await termsProposalCommandService.accept(
        getAuthUserId(req),
        proposalId,
        req.body
      );
      return sendSuccessResponse(res, 'Terms agreed', {
        terms_proposal: withWeeklyEquivalent(accepted),
      });
    } catch (error) {
      return next(error);
    }
  }

  /** POST /terms-proposals/:proposalId/withdraw — the author's side only. */
  static async withdraw(req: Request, res: Response, next: NextFunction) {
    try {
      const proposalId = req.params.proposalId as string;
      const withdrawn = await termsProposalCommandService.withdraw(
        getAuthUserId(req),
        proposalId
      );
      return sendSuccessResponse(res, 'Terms proposal withdrawn', {
        terms_proposal: withWeeklyEquivalent(withdrawn),
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /terms-proposals/:proposalId/decline — B4, the counterparty's
   * refusal. Distinct from `withdraw`: the AUTHOR pulls her own round, the
   * COUNTERPARTY declines someone else's.
   */
  static async decline(req: Request, res: Response, next: NextFunction) {
    try {
      const proposalId = req.params.proposalId as string;
      const declined = await termsProposalCommandService.decline(
        getAuthUserId(req),
        proposalId
      );
      return sendSuccessResponse(res, 'Terms proposal declined', {
        terms_proposal: withWeeklyEquivalent(declined),
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /terms-proposals/:proposalId/remind — WP-G, the author's one-tap
   * nudge.
   *
   * Answers with the INSTANT and not the row. Nothing about the proposal
   * changed — no status, no `updated_at` — and returning it would invite a
   * client to treat chasing as a lifecycle event and render it into §7.2's
   * "How we got here", which is a record of what was offered rather than of
   * who was impatient. The 48-hour refusal is a 409 from the service
   * (`TermsProposalReminderTooSoonError`), handled here like any other.
   */
  static async remind(req: Request, res: Response, next: NextFunction) {
    try {
      const proposalId = req.params.proposalId as string;
      const { reminded_at } = await termsProposalCommandService.remind(
        getAuthUserId(req),
        proposalId
      );
      return sendSuccessResponse(res, 'Reminder sent', { reminded_at });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /terms-proposals/:proposalId/viewed — §5.3's receipt.
   *
   * A POST rather than a side effect of `getById`: that read is also what the
   * AUTHOR does when she checks her own draft home, and folding the stamp
   * into it would make "Viewed" mean "I looked at my own message". The client
   * calls this once, when the review screen mounts WITH DATA (§11's event 5).
   */
  static async markViewed(req: Request, res: Response, next: NextFunction) {
    try {
      const proposalId = req.params.proposalId as string;
      const viewed = await termsProposalCommandService.markViewed(
        getAuthUserId(req),
        proposalId
      );
      return sendSuccessResponse(res, 'Terms proposal marked viewed', {
        terms_proposal: withWeeklyEquivalent(viewed),
      });
    } catch (error) {
      return next(error);
    }
  }
}
