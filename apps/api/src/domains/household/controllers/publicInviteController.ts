/**
 * The public terms page's HTTP layer (§6.2) — unauthenticated, and the ONLY
 * place in this domain that answers a caller with no user.
 *
 * @module domains/household/controllers/publicInviteController
 */
import type { NextFunction, Request, Response } from 'express';
// The wire-edge helpers from the terms domain, imported HERE rather than in
// the query service on purpose: a controller is a leaf nobody imports back, so
// household -> termsProposal at this layer cannot close the cycle that the
// same import one layer down would.
import { withWeeklyEquivalent } from '../../termsProposal/controllers/termsProposalController';
import {
  renderTermRows,
  renderTermsHeader,
} from '../../termsProposal/utils/renderTermRows';
import { HouseholdInviteRepository } from '../repositories/householdInviteRepository';
import type { TermsPreview } from '../schemas';
import { householdQueryService } from '../services/householdQueryService';

const inviteRepo = new HouseholdInviteRepository();

export class PublicInviteController {
  /**
   * GET /v1/household-invites/:code/terms-preview.
   *
   * THE API RETURNS RENDERED STRINGS (§6.2). The worker prints `rows` as it
   * receives them and holds no formatting logic of its own, which is what
   * makes "the family reads the same contract on the web as in the app" a
   * property of the code — the same renderer, the same order, the same words,
   * pinned by `renderTermRows.test.ts` against the mobile builder's source.
   *
   * `weekly_equivalent_minor` is the SERVER-computed figure and nothing else
   * may derive it: at $28.00/hr with overtime after 40h, 50 guaranteed hours
   * is $1,540.00, and a naive `rate × hours` prints $1,400.00 on the page
   * where the contract starts (§17, D23).
   */
  static async termsPreview(req: Request, res: Response, next: NextFunction) {
    try {
      const code = req.params.code as string;
      const source = await householdQueryService.termsPreview(code);
      const proposal = withWeeklyEquivalent(source.proposal);
      const weekly = proposal.weekly_equivalent_minor;
      // The header and the body come from the same pair of renderers the app's
      // own review screen uses, so the two surfaces cannot word the same terms
      // differently.
      const header = renderTermsHeader(proposal.terms, weekly, source.currency);
      const preview: TermsPreview = {
        code: source.code,
        carer_name: source.carer_name,
        proposed_at: source.proposed_at,
        link_expires_at: source.link_expires_at,
        rate: header.rate,
        weekly_line: header.weeklyLine,
        weekly_equivalent_minor: weekly,
        rows: renderTermRows(proposal.terms, source.currency),
      };
      // Field-by-field, never a spread of the source: the proposal row carries
      // her full display name and the household id, and neither belongs on a
      // page anyone with the URL can read.
      return res.status(200).json({ success: true, data: preview });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /v1/household-invites/:code/opened — the worker's read receipt
   * (§5.3 "Opened"), stamped once and idempotently.
   *
   * ALWAYS 204, whatever the code turns out to be. This endpoint takes an
   * unauthenticated write keyed on a guessable-shaped string, so answering
   * differently for a real code than for a made-up one would turn it into an
   * oracle that enumerates live invites — and it would do so on the one
   * surface that has no membership check behind it. There is nothing for a
   * caller to learn and nothing for them to retry.
   */
  static async markOpened(req: Request, res: Response, next: NextFunction) {
    try {
      await inviteRepo.stampOpened(req.params.code as string);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  }
}
