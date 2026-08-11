/**
 * Terms-proposal query service (CQRS-lite: reads). Two reads, one gate.
 *
 * `assertCanReadProposals` (`utils/proposalAccess.ts`) runs BEFORE the
 * repository on every method — the repositories use the service-role client
 * and bypass RLS, so 092's SELECT policy has no force here and this gate IS
 * the policy. It is deliberately narrower than `can_read_household`: a helper
 * and the household's OTHER nanny are both members in good standing, and
 * neither may see a colleague's proposed rate (D-21).
 *
 * Neither read is cached and neither routes through `authWithOwnership` —
 * see `proposalAccess.ts`'s header for the GOLDEN-FIXES #32 reason.
 *
 * @module domains/termsProposal/services/termsProposalQueryService
 */
import { HouseholdMemberRepository } from '../../household';
import { TermsProposalNotFoundError } from '../errors/termsProposalErrors';
import { TermsProposalRepository } from '../repositories/termsProposalRepository';
import type { TermsProposalRow } from '../schemas';
import {
  assertCanReadProposals,
  type MembershipLookup,
} from '../utils/proposalAccess';

export class TermsProposalQueryService {
  constructor(
    private readonly proposalRepo: TermsProposalRepository = new TermsProposalRepository(),
    private readonly members: MembershipLookup = new HouseholdMemberRepository()
  ) {}

  /**
   * The open round for (household, carer), or null.
   *
   * `null` is a NORMAL 200, not a 404: "no proposal open" is the ordinary
   * state of a settled household, and the client renders nothing rather than
   * an error (the same discipline `payArrangementQueryService.getCurrent`
   * uses for a carer with no rate set).
   */
  async getOpen(
    callerId: string,
    householdId: string,
    carerId: string
  ): Promise<TermsProposalRow | null> {
    await assertCanReadProposals(this.members, householdId, callerId, carerId);
    return this.proposalRepo.findOpenForCarer(householdId, carerId);
  }

  /**
   * ONE proposal, by id alone — what the review screen loads from a push deep
   * link carrying only `data.proposalId` (§12: never a spinner on a screen
   * someone opened from a notification about money).
   *
   * The scope comes from the ROW, not the URL: the caller is gated against the
   * proposal's own (household, carer) after it is read. No ownership
   * middleware and no cache — see `proposalAccess.ts`'s header for the
   * GOLDEN-FIXES #32 reason, which bites hardest on exactly this route,
   * because the actions beneath it are strictly narrower than this read.
   */
  async getById(
    callerId: string,
    proposalId: string
  ): Promise<TermsProposalRow> {
    const proposal = await this.proposalRepo.findById(proposalId);
    if (!proposal) {
      throw new TermsProposalNotFoundError({
        proposalId,
        reason: 'no_such_proposal',
      });
    }
    await assertCanReadProposals(
      this.members,
      proposal.household_id,
      callerId,
      proposal.carer_id
    );
    return proposal;
  }

  /**
   * Every round for (household, carer), newest first — §7.2's "How we got
   * here". The WHOLE chain, including withdrawn and countered rows: nothing
   * in this domain is deleted, and a history that quietly omitted the round
   * somebody pulled would be exactly the kind of edited record this feature
   * exists to make impossible.
   */
  async getChain(
    callerId: string,
    householdId: string,
    carerId: string
  ): Promise<TermsProposalRow[]> {
    await assertCanReadProposals(this.members, householdId, callerId, carerId);
    return this.proposalRepo.listChain(householdId, carerId);
  }
}

// Singleton for controllers/routes that don't need DI.
export const termsProposalQueryService = new TermsProposalQueryService();
